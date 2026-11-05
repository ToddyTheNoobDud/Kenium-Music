import { SimpleDB } from '../src/utils/simpleDB.ts'

const database = new SimpleDB({ dbPath: ':memory:' })

try {
  const collection = database.collection('testcoll')
  const document = collection.insert({ foo: 'bar', counter: 0 })
  console.log('Inserted:', document)

  const changes = collection.updateAtomic(
    { _id: document._id },
    { $set: { foo: 'baz' }, $inc: { counter: 5 } }
  )
  console.log('updateAtomic changes:', changes)
  console.log('Found after update:', collection.findById(document._id))

  const hotCollection = database.collection('hotmix', {
    columns: { name: 'TEXT' }
  })
  const mixedDocument = hotCollection.insert({ name: 'old', extra: 'before' })
  hotCollection.update(
    { _id: mixedDocument._id },
    { name: 'new', extra: 'after' }
  )

  const foundByNewName = hotCollection.findOne({ name: 'new' })
  const foundByOldName = hotCollection.findOne({ name: 'old' })
  if (foundByNewName?._id !== mixedDocument._id || foundByOldName) {
    throw new Error('Mixed hot/non-hot update desynchronized indexes')
  }
  console.log('Mixed hot/non-hot update: ok')
} finally {
  database.close()
}
