const mongoose = require('mongoose');

async function exportAllIndexes(uri, dbName) {
  await mongoose.connect(uri, { dbName });

  const collections = await mongoose.connection.db.listCollections().toArray();

  for (const coll of collections) {
    const collection = mongoose.connection.db.collection(coll.name);
    const indexes = await collection.indexes();

    console.log(`\n📦 Collection: ${coll.name}`);
    indexes.forEach(index => {
      console.log({
        key: index.key,
        options: {
          unique: index.unique || false,
          sparse: index.sparse || false,
          name: index.name || undefined,
          ...(index.expireAfterSeconds && { expireAfterSeconds: index.expireAfterSeconds })
        }
      });
    });
  }

  await mongoose.disconnect();
}

// 📌 شغل الدالة بهيك:
exportAllIndexes('mongodb://localhost:27017', 'order-tracker')
  .then(() => console.log('\n✅ Done fetching indexes'))
  .catch(console.error);
