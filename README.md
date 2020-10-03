# Package: mongoose-sub-references-integrity-checker

Package useful for mantaining the sub-references integrity and structure of mongoose models. It provides cascade deleting, and sub-ref support at any nested level. Also include support for soft deleting.

**N.B:**

1. This is based on middleware hook **remove** and **deleteOne** and on **validators**. If you would like to mantain the integrity anyway, you should always use this middleware even on a bunch of data (obviously at the cost of performance) by looping over the collection and deleting singularly every document.

**2) Using sub references is considered in most of the cases an anti-pattern that you should avoid (usually you can re-organize your data to avoid it).**

If you are interested in the integrity of normal references too, (watch this out)[https://github.com/QuantumGlitch/mongoose-references-integrity-checker].

# Dependencies

Mongoose >= 5.10.7,
MongoDB >= 3.6

# Install

For this package :

```shell
npm i mongoose-sub-references-integrity-checker
```

If you would like to integrate it with soft deleting:

```shell
npm i mongoose-sub-references-integrity-checker mongoose-soft-deleting
```

# Setup

For setting up the integrity checker on a mongoose schema, you have two options:

1.

```js
const subReferencesIntegrityChecker = require('mongoose-sub-references-integrity-checker');

const TestSchema = new mongoose.Schema({});
subReferencesIntegrityChecker('Test', TestSchema);
const TestModel = mongoose.model('Test', TestSchema);
```

2.

```js
const { consistentModel } = require('mongoose-sub-references-integrity-checker');

const TestSchema = new mongoose.Schema({});
const TestModel = consistentModel('Test', TestSchema);
```

# Concepts

## Sub Reference

A sub reference is a reference to a sub document nested inside a root document.

## Sub Reference States

A sub reference could stay in three possible states:

- **Required**
  ( Deleting the parent of the relationship will throw an error )
- **Required and Cascade**
  ( Deleting the parent of the relationship will delete all of his children )
- **Not required**
  ( Deleting the parent will unset the sub ref on all of his children )

### Required

Setting up the models in this way :

```js
const { consistentModel, SubRefConstraintError } = require('mongoose-sub-references-integrity-checker');

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

        // Required
        required: true,
    },
    content: {
        type: String,
    },
});
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and child

const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        },
        {
            email: 'test2@test.com',
        },
    ],
}).save();

const child = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

...

// Deleting the root document
try {
    await parent.deleteOne();

    throw 'This should never happen !';
} catch (e) {
    assert(e instanceof SubRefConstraintError);
}

// Or removing the sub document
try {
    // Remove the first contact
    parent.contacts.shift();
    // Try save the parent
    await parent.save();

    throw 'This should never happen !';
} catch (e) {
    assert(e.constructor.name, 'ValidationError');
}
```

Would lead in the situation in which when you delete the parent on the relationship (e.g. Person) then will be thrown a SubRefConstraintError.

The same would be the situation in which you remove the referenced sub document, through a validator we would get a ValidationError.

The sub reference is required on the child of the relationship, so you can't delete the parent without unsetting the sub reference first.

### Required and Cascade

Consider this situation:

```js
const { consistentModel } = require('mongoose-sub-references-integrity-checker');

// Same PersonSchema of last example
const PersonModel = consistentModel('Person', PersonSchema);

const MessageSchema = new mongoose.Schema({
    contact: {
        type: mongoose.Schema.Types.ObjectId,
        subRef: 'Person.contacts',

        // Required and cascade
        required: true,
        cascade: true
    },
    content: {
        type: String,
    },
});
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and children

const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        },
        {
            email: 'test2@test.com',
        },
    ],
}).save();

const child0 = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

const child1 = await new MessageModel({
    contact: parent.contacts[1]._id,
}).save();

...

// Delete root document
{
    await parent.deleteOne();
}
// Or delete sub documents
{
    parent.contacts = [];
    await parent.save();

    // Wait for updates on relationship to be executed
    // This is optional, it is useful only if you want to be sure that all updates finished
    await parent.subRefsUpdates();
}

...

// All deleted
assert(!await PersonModel.findById(parent._id));
assert(!await MessageModel.findById(child0._id));
assert(!await MessageModel.findById(child1._id));
```

Deleting the root document of the parent of the relationship, or deleting the parent sub document, will delete all his children.

### Not Required

This is the last use case :

```js
const { consistentModel } = require('mongoose-sub-references-integrity-checker');

// Same PersonSchema of last example
const PersonModel = consistentModel('Person', PersonSchema);

const MessageSchema = new mongoose.Schema({
    contact: {
        type: mongoose.Schema.Types.ObjectId,
        subRef: 'Person.contacts',

        // Not Required
        required: false,
    },
    content: {
        type: String,
    },
});
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and child
const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        }
    ],
}).save();

const child = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

...

// Deleting the root document
{
    await parent.deleteOne();
}
// Or deleting the sub document
{
    // Remove the first contact
    parent.contacts.shift();

    // Try save the parent
    await parent.save();

    // Optional if you don't to check child anymore:
    // Wait for updates on relationship to be executed
    await parent.subRefsUpdates();
}

...

// Sub ref on child will be null
assert(!child.contact);
```

If the sub reference is not required then deleting the root document of the parent of the relationship, or deleting the parent sub document, will unset the sub ref on all his children.

## Nesting - Child of the relationship

In the last examples we've seen the most simple case, in which the ref on the child is in the root of the document. Any way you can nest it in the way you prefer and the usage will be the same.

```js
const MessageSchema = new mongoose.Schema({
  pathToRef: {
    ...
        {
            anyProp: [
                ...
                    propertyIfYouWant: {
                        type: mongoose.Schema.Types.ObjectId,
                        subRef: 'Person.contacts',
                        ... (subRefOptions)
                    }
                ...
            ]
        }
    ...
  },
});
```

## Nesting - Parent of the relationship

You can provide any path you like to the subRef prop on SchemaType, the important thing is that is a direct path to a sub document array or array. This means that you can't provide a path to an array nested in another array.

**Valid example:**

```js
const PersonSchema = new mongoose.Schema({
  contacts: [
    {
      type: 'String',
      default: 'test@test',
    },
  ],
});
const MessageSchema = new mongoose.Schema({
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    subRef: 'Person.contacts',
  },
});
```

**Invalid example:**

```js
const PersonSchema = new mongoose.Schema({
  contacts: [
    {
      bossContacts: [
        {
          type: String,
        },
      ],
    },
  ],
});
const MessageSchema = new mongoose.Schema({
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    subRef: 'Person.contacts.bossContacts',
  },
});
```

## Soft Delete

Optionally you can combine the usage of the library [mongoose-soft-deleting](https://github.com/QuantumGlitch/mongoose-soft-delete#readme) with this package.

The behaviour in this case will be about the same with some differences.

### Required

If you try to soft delete the parent of the relationship, then will be thrown the same SubRefConstraintError as before.

```js
const softDeletePlugin = require('mongoose-soft-deleting');
const { consistentModel, SubRefConstraintError } = require('mongoose-sub-references-integrity-checker');

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

        // Required
        required: true,
    },
    content: {
        type: String,
    },
});
MessageSchema.plugin(softDeletePlugin);
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and child

const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        }
    ],
}).save();

const child = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

...

// Deleting the root document
try {
    await parent.softDelete(true);

    throw 'This should never happen !';
} catch (e) {
    assert(e instanceof SubRefConstraintError);
}
```

### Required and cascade

If you try to soft delete or restore the parent of the relationship then all his children will have the same fate.

```js
const softDeletePlugin = require('mongoose-soft-deleting');

const { consistentModel } = require('mongoose-sub-references-integrity-checker');

// Same PersonSchema of last example
const PersonModel = consistentModel('Person', PersonSchema);

const MessageSchema = new mongoose.Schema({
    contact: {
        type: mongoose.Schema.Types.ObjectId,
        subRef: 'Person.contacts',

        // Required and cascade
        required: true,
        cascade: true
    },
    content: {
        type: String,
    },
});
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and children

const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        },
        {
            email: 'test2@test.com',
        },
    ],
}).save();

const child0 = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

const child1 = await new MessageModel({
    contact: parent.contacts[1]._id,
}).save();

...

// Soft delete
await parent.softDelete(true);

// All soft deleted
assert((await PersonModel.findById(parent._id)).isSoftDeleted());
assert((await MessageModel.findById(child0._id)).isSoftDeleted());
assert((await MessageModel.findById(child1._id)).isSoftDeleted());

// Restore
await parent.softDelete(false);

// All restored
assert(!((await PersonModel.findById(parent._id)).isSoftDeleted()));
assert(!((await MessageModel.findById(child0._id)).isSoftDeleted()));
assert(!((await MessageModel.findById(child1._id)).isSoftDeleted()));

```

### Not required

If you try to soft delete the parent of the relationship then only the parent will be soft deleted. The child will still have his reference set to the parent (because even if the parent is soft deleted, it still exists with his sub document).

```js
const softDeletePlugin = require('mongoose-soft-deleting');

const { consistentModel } = require('mongoose-sub-references-integrity-checker');

// Same PersonSchema of last example
const PersonModel = consistentModel('Person', PersonSchema);

const MessageSchema = new mongoose.Schema({
    contact: {
        type: mongoose.Schema.Types.ObjectId,
        subRef: 'Person.contacts',

        // Not Required
        required: false,
    },
    content: {
        type: String,
    },
});
const MessageModel = consistentModel('Message', MessageSchema);

...

// Setup parent and child
const parent = await new PersonModel({
    contacts: [
        {
            email: 'test@test.com',
        }
    ],
}).save();

const child = await new MessageModel({
    contact: parent.contacts[0]._id,
}).save();

...

// Soft delete
await parent.softDelete(true);

child = await MessageModel.findById(child._id);
// Ref on child will be the same
assert(child.contact.equals(parent.contacts[0]._id));
```

# Test

You can try the tests using the following command ( before you need to change the connection to MongoDB ) :
`npm run test`

# See also

If you are using references you could be interested in (sub-references-populate)[https://github.com/QuantumGlitch/mongoose-sub-references-populate]

# Support

If you would like to support my work, [please buy me a coffe ☕](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=HRVBJMSU9CQXW).
Thanks in advice.
