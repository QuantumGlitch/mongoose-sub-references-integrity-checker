const assert = require('assert');
const mongoose = require('mongoose');
const { consistentModel, SubRefConstraintError } = require('..');

mongoose.connect('mongodb://root@localhost:27017/admin', {
  dbName: 'mongoose-sub-references-integrity-checker',
  useUnifiedTopology: true,
});

mongoose.connection.on('error', console.error.bind(console, "Con't connect to MongoDB."));

describe('Sub References - Simple - Deleting the parent of the relationship', async function () {
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

  it('subRef is required, block deleteOne ---> should throw SubRefConstraintError', async function () {
    try {
      await parent.deleteOne();
      throw 'This should never happen !';
    } catch (e) {
      if (!(e instanceof SubRefConstraintError)) throw e;
    }

    child = await MessageModel.findById(child._id);
    assert(child, 'child should exists');
    assert(
      parent.contacts.find((c) => child.contact.equals(c._id)),
      'child should have sub ref to parent'
    );
  });

  it('subRef is not required, deleteOne ---> should just delete the parent of the relationship and set null his sub reference on the child', async function () {
    MessageSchema.path('contact').required = false;
    await parent.deleteOne();
    assert(!(await PersonModel.findById(parent._id)), "parent shouldn't exists");

    child = await MessageModel.findById(child._id);
    assert(!child.contact, "child's ref to deleted parent should be null");
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

    await parent.deleteOne();

    assert(!(await PersonModel.findById(parent._id)), "parent shouldn't exists");
    assert(!(await MessageModel.findById(children[0]._id)), "child shouldn't exists");
    assert(!(await MessageModel.findById(children[1]._id)), "child shouldn't exists");
    assert(!(await MessageModel.findById(children[2]._id)), "child shouldn't exists");
  });
});

describe('Sub References - Simple - Deleting subDocument from the parent of the relationship', async function () {
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
  const PersonModel = consistentModel('Person_2', PersonSchema);

  const MessageSchema = new mongoose.Schema({
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      subRef: 'Person_2.contacts',
      required: true,
    },
    content: {
      type: String,
    },
  });
  const MessageModel = consistentModel('Message_2', MessageSchema);

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

  it('subRef is required, block removing of referenced subdocument ---> should throw SubRefConstraintError', async function () {
    try {
      // Remove the first contact
      parent.contacts.shift();
      // Try save the parent
      await parent.save();
      throw 'This should never happen !';
    } catch (e) {
      if (!(e.constructor.name === 'ValidationError')) throw e;
    }

    child = await MessageModel.findById(child._id);
    assert(child, 'child should exists');
    assert(
      parent.contacts.find((c) => child.contact.equals(c._id)),
      'child should have sub ref to parent'
    );
  });

  it('subRef is not required, removing of referenced subdocument ---> should just set null his sub reference on the child', async function () {
    MessageSchema.path('contact').required = false;

    // Remove the first contact
    parent.contacts.shift();

    // Try save the parent
    await parent.save();

    // Wait for updates on relationship to be executed
    await parent.subRefsUpdates();

    child = await MessageModel.findById(child._id);
    assert(!child.contact, "child's ref to deleted sub document parent should be null");
  });

  it('subRef is required, removing of referenced subdocument ---> should delete the sub document parent of the relationship and his children', async function () {
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

    // Remove the first contact
    parent.contacts.shift();

    // Try save the parent
    await parent.save();

    // Wait for updates on relationship to be executed
    await parent.subRefsUpdates();

    assert(!(await MessageModel.findById(children[0]._id)), "child shouldn't exists");
    assert(await MessageModel.findById(children[1]._id), 'child should exists');
    assert(!(await MessageModel.findById(children[2]._id)), "child shouldn't exists");
  });
});

describe('Sub References - Nested - Deleting the parent of the relationship', async function () {
  const PersonSchema = new mongoose.Schema({
    name: {
      type: String,
    },
    info: {
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
    },
  });
  const PersonModel = consistentModel('Person_3', PersonSchema);

  const MessageSchema = new mongoose.Schema({
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      subRef: 'Person_3.info.contacts',
      required: true,
    },
    content: {
      type: String,
    },
  });
  const MessageModel = consistentModel('Message_3', MessageSchema);

  let parent, child;

  before(async function () {
    await PersonModel.deleteMany({});
    await MessageModel.deleteMany({});

    parent = await new PersonModel({
      info: {
        contacts: [
          {
            email: 'test@test.com',
          },
          {
            email: 'test2@test.com',
          },
        ],
      },
    }).save();

    child = await new MessageModel({
      contact: parent.info.contacts[0]._id,
    }).save();
  });

  it('subRef is required, block deleteOne ---> should throw SubRefConstraintError', async function () {
    try {
      await parent.deleteOne();
      throw 'This should never happen !';
    } catch (e) {
      if (!(e instanceof SubRefConstraintError)) throw e;
    }

    child = await MessageModel.findById(child._id);
    assert(child, 'child should exists');
    assert(
      parent.info.contacts.find((c) => child.contact.equals(c._id)),
      'child should have sub ref to parent'
    );
  });

  it('subRef is not required, deleteOne ---> should just delete the parent of the relationship and set null his sub reference on the child', async function () {
    MessageSchema.path('contact').required = false;
    await parent.deleteOne();
    assert(!(await PersonModel.findById(parent._id)), "parent shouldn't exists");

    child = await MessageModel.findById(child._id);
    assert(!child.contact, "child's ref to deleted parent should be null");
  });

  it('subRef is required, deleteOne cascade ---> should delete the parent of the relationship and his children', async function () {
    MessageSchema.path('contact').required = true;
    MessageSchema.path('contact').cascade = true;

    parent = await new PersonModel({
      info: {
        contacts: [
          {
            email: 'test@test.com',
          },
          {
            email: 'test2@test.com',
          },
        ],
      },
    }).save();

    const children = [
      await new MessageModel({ contact: parent.info.contacts[0]._id }).save(),
      await new MessageModel({ contact: parent.info.contacts[1]._id }).save(),
      await new MessageModel({ contact: parent.info.contacts[0]._id }).save(),
    ];

    await parent.deleteOne();

    assert(!(await PersonModel.findById(parent._id)), "parent shouldn't exists");
    assert(!(await MessageModel.findById(children[0]._id)), "child shouldn't exists");
    assert(!(await MessageModel.findById(children[1]._id)), "child shouldn't exists");
    assert(!(await MessageModel.findById(children[2]._id)), "child shouldn't exists");
  });
});

describe('Sub References - Nested - Deleting subDocument from the parent of the relationship', async function () {
  const PersonSchema = new mongoose.Schema({
    name: {
      type: String,
    },
    info: {
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
    },
  });
  const PersonModel = consistentModel('Person_4', PersonSchema);

  const MessageSchema = new mongoose.Schema({
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      subRef: 'Person_4.info.contacts',
      required: true,
    },
    content: {
      type: String,
    },
  });
  const MessageModel = consistentModel('Message_4', MessageSchema);

  let parent, child;

  before(async function () {
    await PersonModel.deleteMany({});
    await MessageModel.deleteMany({});

    parent = await new PersonModel({
      info: {
        contacts: [
          {
            email: 'test@test.com',
          },
          {
            email: 'test2@test.com',
          },
        ],
      },
    }).save();

    child = await new MessageModel({
      contact: parent.info.contacts[0]._id,
    }).save();
  });

  it('subRef is required, block removing of referenced subdocument ---> should throw SubRefConstraintError', async function () {
    try {
      // Remove the first contact
      parent.info.contacts.shift();
      // Try save the parent
      await parent.save();
      throw 'This should never happen !';
    } catch (e) {
      if (!(e.constructor.name === 'ValidationError')) throw e;
    }

    child = await MessageModel.findById(child._id);
    assert(child, 'child should exists');
    assert(
      parent.info.contacts.find((c) => child.contact.equals(c._id)),
      'child should have sub ref to parent'
    );
  });

  it('subRef is not required, removing of referenced subdocument ---> should just set null his sub reference on the child', async function () {
    MessageSchema.path('contact').required = false;

    // Remove the first contact
    parent.info.contacts.shift();

    // Try save the parent
    await parent.save();

    // Wait for updates on relationship to be executed
    await parent.subRefsUpdates();

    child = await MessageModel.findById(child._id);
    assert(!child.contact, "child's ref to deleted sub document parent should be null");
  });

  it('subRef is required, removing of referenced subdocument ---> should delete the sub document parent of the relationship and his children', async function () {
    MessageSchema.path('contact').required = true;
    MessageSchema.path('contact').cascade = true;

    parent = await new PersonModel({
      info: {
        contacts: [
          {
            email: 'test@test.com',
          },
          {
            email: 'test2@test.com',
          },
        ],
      },
    }).save();

    const children = [
      await new MessageModel({ contact: parent.info.contacts[0]._id }).save(),
      await new MessageModel({ contact: parent.info.contacts[1]._id }).save(),
      await new MessageModel({ contact: parent.info.contacts[0]._id }).save(),
    ];

    // Remove the first contact
    parent.info.contacts.shift();

    // Try save the parent
    await parent.save();

    // Wait for updates on relationship to be executed
    await parent.subRefsUpdates();

    assert(!(await MessageModel.findById(children[0]._id)), "child shouldn't exists");
    assert(await MessageModel.findById(children[1]._id), 'child should exists');
    assert(!(await MessageModel.findById(children[2]._id)), "child shouldn't exists");
  });
});
