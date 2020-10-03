const assert = require('assert');
const mongoose = require('mongoose');
const softDeletePlugin = require('mongoose-soft-deleting');
const { consistentModel, SubRefConstraintError } = require('..');

mongoose.connect('mongodb://root@localhost:27017/admin', {
  dbName: 'mongoose-sub-references-integrity-checker',
  useUnifiedTopology: true,
});

mongoose.connection.on('error', console.error.bind(console, "Con't connect to MongoDB."));

describe('Sub References - Simple - Soft deleting the parent of the relationship', async function () {
  const PersonSchema = new mongoose.Schema({
    name: {
      type: String,
    },
    contacts: [
      {
        email: {
          type: String,
          required: true,
        },
        telephone: {
          type: String,
          required: false,
        },
      },
    ],
  });
  PersonSchema.plugin(softDeletePlugin);
  const PersonModel = consistentModel('Person', PersonSchema);

  const MessageSchema = new mongoose.Schema({
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      subRef: 'Person.contacts',
      required: true,
    },
    content: {
      type: String,
    },
  });
  MessageSchema.plugin(softDeletePlugin);
  const MessageModel = consistentModel('Message', MessageSchema);

  let parent, child;

  before(async function () {
    await PersonModel.deleteMany({});
    await MessageModel.deleteMany({});

    parent = await new PersonModel({
      contacts: [
        {
          email: 'test@test.com',
        },
        {
          email: 'test2@test.com',
        },
      ],
    }).save();

    child = await new MessageModel({
      contact: parent.contacts[0]._id,
    }).save();
  });

  it('subRef is required, block softDelete ---> should throw SubRefConstraintError', async function () {
    try {
      await parent.softDelete(true);
      throw 'This should never happen !';
    } catch (e) {
      if (!(e instanceof SubRefConstraintError)) throw e;
    }

    parent = await PersonModel.findById(parent._id);
    assert(!parent._deleted, 'parent should not be soft deleted');

    child = await MessageModel.findById(child._id);
    assert(!child._deleted, 'child should not be soft deleted');
  });

  it('subRef is not required ---> should just soft delete the parent of the relationship and preserve the sub reference on the child', async function () {
    MessageSchema.path('contact').required = false;
    await parent.softDelete(true);

    parent = await PersonModel.findById(parent._id);
    assert(parent._deleted, 'parent should be soft deleted');

    child = await MessageModel.findById(child._id);
    assert(!child._deleted, 'child should not be soft deleted');
    assert(
      parent.contacts.find((c) => child.contact.equals(c._id)),
      'child should have the same sub ref to parent'
    );
  });

  it('subRef is required, deleteOne cascade ---> should delete the parent of the relationship and his children', async function () {
    MessageSchema.path('contact').required = true;
    MessageSchema.path('contact').cascade = true;

    parent = await new PersonModel({
      contacts: [
        {
          email: 'test@test.com',
        },
        {
          email: 'test2@test.com',
        },
      ],
    }).save();

    const children = [
      await new MessageModel({ contact: parent.contacts[0]._id }).save(),
      await new MessageModel({ contact: parent.contacts[1]._id }).save(),
      await new MessageModel({ contact: parent.contacts[0]._id }).save(),
    ];

    await parent.softDelete(true);

    parent = await PersonModel.findById(parent._id);
    assert(parent._deleted, 'parent should be soft deleted');

    children[0] = await MessageModel.findById(children[0]._id);
    children[1] = await MessageModel.findById(children[1]._id);
    children[2] = await MessageModel.findById(children[2]._id);

    assert(children[0]._deleted, 'child should be soft deleted');
    assert(children[1]._deleted, 'child should be soft deleted');
    assert(children[2]._deleted, 'child should be soft deleted');

    // restore all
    await parent.softDelete(false);

    parent = await PersonModel.findById(parent._id);
    assert(!parent._deleted, 'parent should not be soft deleted');

    children[0] = await MessageModel.findById(children[0]._id);
    children[1] = await MessageModel.findById(children[1]._id);
    children[2] = await MessageModel.findById(children[2]._id);

    assert(!children[0]._deleted, 'child should not be soft deleted');
    assert(!children[1]._deleted, 'child should not be soft deleted');
    assert(!children[2]._deleted, 'child should not be soft deleted');
  });
});
