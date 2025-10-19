const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin with credentials from GitHub Secrets
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

async function checkPrices() {
  const firestore = admin.firestore();
  const productsSnapshot = await firestore.collection('user_products').get();

  for (const doc of productsSnapshot.docs) {
    const product = doc.data();
    const currentSavedPrice = product.currentPrice;
    const productName = product.productName;

    // Fetch current price from RapidAPI
    let newPrice;
    try {
      const response = await axios.get('https://real-time-product-search.p.rapidapi.com/search-v2', {
        headers: {
          'x-rapidapi-key': '97e3023e1dmsh8984c0200bf425fp15e25fjsna688dac1d155',
          'x-rapidapi-host': 'real-time-product-search.p.rapidapi.com',
        },
        params: {
          q: productName,
          country: 'us',
          language: 'en',
          limit: '1',
        },
      });

      const products = response.data.data?.products || [];
      if (products.length > 0 && products[0].offer?.price) {
        newPrice = parseFloat(products[0].offer.price);
      } else {
        console.log(`No price found for ${product.productId}`);
        continue;
      }
    } catch (error) {
      console.error(`Error fetching price for ${product.productId}: ${error.message}`);
      continue;
    }

    if (newPrice < currentSavedPrice) {
      await doc.ref.update({ currentPrice: newPrice });

      const userDoc = await firestore.collection('users').doc(product.userId).get();
      const fcmToken = userDoc.data()?.fcmToken;
      if (fcmToken) {
        const message = {
          notification: {
            title: 'Price Drop Alert!',
            body: `The price of ${product.productName} dropped to $${newPrice.toFixed(2)} from $${currentSavedPrice.toFixed(2)}.`,
          },
          token: fcmToken,
        };
        try {
          await admin.messaging().send(message);
          console.log(`Notification sent to user ${product.userId} for ${product.productId}`);
        } catch (error) {
          console.error(`Error sending notification to ${product.userId}: ${error.message}`);
        }
      }
    }
  }
}

checkPrices()
  .then(() => {
    console.log('Price check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error in price check:', error);
    process.exit(1);
  });