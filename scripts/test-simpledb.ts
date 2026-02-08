import { SimpleDB } from '../src/utils/simpleDB'

async function main() {
  try {
    const db = new SimpleDB({ dbPath: './db/test_sey.sqlite', cacheSize: 10 })
    const col = db.collection('testcoll')

    // Clean up any existing doc with same _id by just creating a fresh one
    const raw = col.insert({ foo: 'bar', counter: 0, arr: [] })
    const doc = Array.isArray(raw) ? raw[0] : raw
    console.log('Inserted:', doc)

    const changes = col.updateAtomic(
      { _id: doc._id },
      {
        $set: { foo: 'baz' },
        $inc: { counter: 5 },
        $push: { arr: { added: true } }
      }
    )
    console.log('updateAtomic changes:', changes)

    const found = col.findById(doc._id)
    console.log('Found after update:', found)

    db.close()
    process.exit(0)
  } catch (err) {
    console.error('Test failed:', err)
    process.exit(1)
  }
}

main()
