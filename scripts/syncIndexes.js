// scripts/syncIndexes.js
const indexList = require('../utils/indexList');

async function syncIndexesForModel({ model, name, indexes }) {
  const collection = model.collection;
  const existingIndexes = await collection.indexes();
  const existingKeys = existingIndexes.map(i => JSON.stringify(i.key));

  let added = [];

  for (const idx of indexes) {
    const strKey = JSON.stringify(idx.key);
    if (!existingKeys.includes(strKey)) {
      await collection.createIndex(idx.key, idx.options || {});
      added.push(idx.key);
    }
  }

  if (added.length) {
    console.log(`✅ [${name}] Added ${added.length}/${indexes.length} indexes:`);
    added.forEach((key, i) => console.log(`  ${i + 1}.`, key));
  } else {
    console.log(`✔️ [${name}] All indexes already exist (${indexes.length})`);
  }
}

async function run() {
  console.log('\n🧠 Syncing indexes...');
  for (const item of indexList) {
    await syncIndexesForModel(item);
  }
  console.log('🎯 Done syncing all indexes.\n');
}

module.exports = { run };
