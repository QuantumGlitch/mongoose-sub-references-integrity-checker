const mongoose = require('../mongoose') || require('mongoose');

const oldValuesPlugin = require('mongoose-old-values');
const SubRefConstraintError = require('./error');

const refs = {};

// Return model name of the subRef
function getRootRef(subRef) {
  return subRef.split('.')[0];
}

function getReferencedValues(pathSubRef, referencedDocument) {
  // referenced ids or exact values
  return referencedDocument.get(pathSubRef).map((d) => d._id || d);
}

function getFindQueryObjectFor(modelRef, pathRef, referencedValues, boundRefValue) {
  return boundRefValue
    ? { _id: boundRefValue }
    : {
        [pathRef]: { $in: referencedValues },
      };
}

function getUpdateQueryObjectFor(modelRef, pathRef, referencedValues) {
  const path = pathRef instanceof Array ? pathRef : pathRef.split('.');
  const model = mongoose.model(modelRef);
  const fieldRefSchemaType = model.schema.path(pathRef);
  const result = [];
  const info = [];
  let lastDocumentArray = null;

  // Build info for updating
  for (let i = 0; i < path.length - 1; i++) {
    const absolutePath = path.filter((_, i2) => i2 <= i);
    const schemaType = model.schema.path(absolutePath.join('.'));

    if (schemaType && schemaType.constructor.name === 'DocumentArrayPath') {
      // Is an array
      lastDocumentArray = i;
      info.push({ array: true });
      continue;
    }

    info.push({});
  }

  let updatePath = '';
  let arrayFilterConditionPath = '';

  // Build path for update query
  for (let i = 0; i < info.length; i++) {
    updatePath +=
      path[i] + '.' + (info[i].array ? (i === lastDocumentArray ? '$[j].' : '$[].') : '');

    if (lastDocumentArray !== null && i > lastDocumentArray)
      arrayFilterConditionPath += path[i] + '.';
  }

  // add last element of the path
  updatePath += path[path.length - 1];
  arrayFilterConditionPath += path[path.length - 1];

  // fieldRefSchemaType is the last schemaType of the path
  // If it is array of refs then use pull else set (remove from the array the ref or set null the ref)
  const operator = fieldRefSchemaType.constructor.name === 'SchemaArray' ? '$pull' : '$set';

  // Update
  result.push({
    [operator]: {
      [updatePath]: operator === '$pull' ? { $in: referencedValues } : null,
    },
  });

  // Update options
  // If we have found at the least one document array
  if (lastDocumentArray !== null)
    result.push({
      arrayFilters: [{ [`j.${arrayFilterConditionPath}`]: { $in: referencedValues } }],
    });

  return result;
}

async function onDeleteSetNull(
  modelRef,
  pathRef,
  modelSubRef,
  pathSubRef,
  referencedValues,
  boundRefValue,
  { softDelete = false, _deleted } = {}
) {
  if (!softDelete)
    await mongoose
      .model(modelRef)
      .updateMany(
        getFindQueryObjectFor(modelRef, pathRef, referencedValues, boundRefValue),
        ...getUpdateQueryObjectFor(modelRef, pathRef, referencedValues)
      )
      .exec();
}

async function onDeleteCascade(
  modelRef,
  pathRef,
  modelSubRef,
  pathSubRef,
  referencedValues,
  boundRefValue,
  { softDelete = false, _deleted } = {}
) {
  const queryObject = getFindQueryObjectFor(modelRef, pathRef, referencedValues, boundRefValue);

  const documents = await mongoose.model(modelRef).find(queryObject).exec();

  if (softDelete)
    // We need to use the softDelete function to trigger again the hooks for checking sub references
    await Promise.all(documents.map((doc) => doc.softDelete(_deleted)));
  // We need to use the deleteOne function to trigger again the hooks for checking sub references
  else await Promise.all(documents.map((doc) => doc.deleteOne()));
}

async function onDeleteBlock(
  modelRef,
  pathRef,
  modelSubRef,
  pathSubRef,
  referencedValues,
  boundRefValue,
  { softDelete = false, _deleted } = {}
) {
  if (!softDelete || _deleted) {
    const constrainedDoc = await mongoose
      .model(modelRef)
      .findOne(getFindQueryObjectFor(modelRef, pathRef, referencedValues, boundRefValue))
      .exec();

    if (constrainedDoc)
      // Cannot remove if exists at least one referencing this document
      throw new SubRefConstraintError({
        modelSubRef,
        pathSubRef,
        modelRef,
        pathRef,
        constrainedDocId: constrainedDoc._id,
      });
  }
}

async function onDeleteConditions(
  schemaType,
  modelRef,
  pathRef,
  modelSubRef,
  pathSubRef,
  referencedValues,
  boundRefValue,
  softDeleteOptions
) {
  if (schemaType.required) {
    // This reference is required
    if (schemaType.cascade)
      // Delete references on cascade
      await onDeleteCascade(
        modelRef,
        pathRef,
        modelSubRef,
        pathSubRef,
        referencedValues,
        boundRefValue,
        softDeleteOptions
      );
    // Block delete if references exist
    else
      await onDeleteBlock(
        modelRef,
        pathRef,
        modelSubRef,
        pathSubRef,
        referencedValues,
        boundRefValue,
        softDeleteOptions
      );
  }
  // Not required, we can simply set null the reference
  else
    await onDeleteSetNull(
      modelRef,
      pathRef,
      modelSubRef,
      pathSubRef,
      referencedValues,
      boundRefValue,
      softDeleteOptions
    );
}

function plugin(modelName, schema) {
  if (!refs[modelName]) refs[modelName] = [];

  function eachPath(path, schemaType) {
    // Array of primitives
    if (schemaType.constructor.name === 'SchemaArray' && schemaType.options.type[0].subRef) {
      refs[getRootRef(schemaType.options.type[0].subRef)] = [
        ...(refs[schemaType.options.subRef] || []),
        { modelName, path: path, schemaType: schemaType.options.type[0] },
      ];

      setValidator(path, schemaType.options.type[0]);
    } else if (schemaType.schema) {
      schemaType.schema.eachPath((subPath, subSchemaType) =>
        eachPath(path + '.' + subPath, subSchemaType)
      );
    }
    // Primitive fields or nested object fields
    else if (schemaType.options.subRef) {
      refs[getRootRef(schemaType.options.subRef)] = [
        ...(refs[schemaType.options.subRef] || []),
        { modelName, path, schemaType },
      ];

      setValidator(path, schemaType);
    }
  }

  // Search for sub refs in schema
  schema.eachPath((path, schemaType) => eachPath(path, schemaType));

  async function onDelete(document, softDeleteOptions) {
    for (let { modelName: modelRef, path, schemaType } of refs[modelName]) {
      // Remove the model name from the ref
      const pathSubRef = schemaType.options.subRef.substr(modelName.length + 1);

      // Is field boundTo the root document ref ?
      const boundRefValue = schemaType.options.boundTo
        ? document.get(schemaType.options.boundTo)
        : null;

      await onDeleteConditions(
        schemaType,
        modelRef,
        path,
        modelName,
        pathSubRef,
        getReferencedValues(pathSubRef, document),
        boundRefValue,
        softDeleteOptions
      );
    }
  }

  // Before remove, check if the removing is possible
  schema.pre('remove', { document: true }, async function () {
    await onDelete(this);
  });

  // Before deleteOne, check if the removing is possible
  schema.pre('deleteOne', { document: true }, async function () {
    await onDelete(this);
  });

  //#region Validator

  // Needed for validator
  schema.plugin(oldValuesPlugin);

  /**
   *  When saving a sub referenced documents collection,
   *  we must be sure that deleted elements will
   *  not compromise sub references
   */
  function setValidator(path, schemaType) {
    // path to reach sub ref
    const subRefModel = getRootRef(schemaType.options.subRef);
    const pathSubRef = schemaType.options.subRef.substr(subRefModel.length + 1);

    mongoose
      .model(subRefModel)
      .schema.path(pathSubRef)
      // a sub ref is always directed to an array of subdocuments or primitives
      .validate({
        validator: async function (newValues) {
          const oldValues = this.$locals.old ? this.$locals.old.get(pathSubRef) : [];
          const deletedValues = oldValues.filter(
            (o) =>
              !newValues.some(
                o._id
                  ? // Array of subdocuments
                    (n) => o._id.equals(n._id)
                  : // Array of primitives
                    (n) => (o.equals ? o.equals(n) : o === n)
              )
          );

          if (deletedValues.length > 0) {
            try {
              const remover = async () => {
                // Is field boundTo the root document ref ?
                const boundRefValue = schemaType.options.boundTo
                  ? this.get(schemaType.options.boundTo)
                  : null;

                await onDeleteConditions(
                  schemaType,
                  modelName,
                  path,
                  subRefModel,
                  pathSubRef,
                  // Referenced values
                  deletedValues.map((d) => d._id || d),
                  boundRefValue
                );
              };

              // This is the only case in which, this can be used directly (because it can only throw an error to stop the validation)
              if (schemaType.required && !schemaType.cascade) await remover();
              // Otherwise we will need to run updates, after validation is completed
              // We can't run updates now, because a successive validator could stop the saving and at the point we need to rollback
              else
                this.$locals.subRefUpdateAfterSave = [
                  ...(this.$locals.subRefUpdateAfterSave || []),
                  remover,
                ];
            } catch (e) {
              if (e instanceof SubRefConstraintError) {
                // Rollback to previous values
                this.set(pathSubRef, oldValues);

                throw new Error(
                  `Can't delete the sub document of 
                    ${e.options.modelSubRef} --> ${e.options.pathSubRef}
                    from which depends 
                    ${e.options.modelRef} --> ${e.options.pathRef}. 
                    (Constrained by document: ${e.options.constrainedDocId})`
                );
              }

              throw e;
            }
          }

          return true;
        },
        type: 'subRefConstraint',
      });
  }

  // This middleware will be used for update operations after validation of the sub documents
  schema.post('save', async function () {
    if (this.$locals.subRefUpdateAfterSave)
      try {
        this.$locals.subRefUpdatedAfterSave = false;

        await Promise.all(this.$locals.subRefUpdateAfterSave.map((c) => c()));
        delete this.$locals.subRefUpdateAfterSave;
        if (this.$locals.subRefUpdateAfterSaveResolver)
          this.$locals.subRefUpdateAfterSaveResolver();

        this.$locals.subRefUpdatedAfterSave = true;
      } catch (e) {
        delete this.$locals.subRefUpdateAfterSave;
        if (this.$locals.subRefUpdateAfterSaveRejecter)
          this.$locals.subRefUpdateAfterSaveRejecter(e);

        this.$locals.subRefUpdatedAfterSave = true;
        throw e;
      }
  });

  schema.methods.subRefsUpdates = function () {
    return new Promise((resolve, reject) => {
      if (this.$locals.subRefUpdatedAfterSave) resolve();

      const previousResolver = this.$locals.subRefUpdateAfterSaveResolver;
      const previousRejecter = this.$locals.subRefUpdateAfterSaveRejecter;

      this.$locals.subRefUpdateAfterSaveResolver = function () {
        if (previousResolver) previousResolver();
        resolve();
      };

      this.$locals.subRefUpdateAfterSaveRejecter = function (e) {
        if (previousRejecter) previousRejecter(e);
        reject(e);
      };
    });
  };

  //#endregion

  schema.plugin((schema) => {
    // If soft deleting is available
    if (schema.statics.preSoftDelete)
      schema.statics.preSoftDelete(async (document) => {
        try {
          await onDelete(document, { softDelete: true, _deleted: document._deleted });
        } catch (e) {
          // Deleting was blocked
          if (e instanceof SubRefConstraintError)
            // Rollback then
            document._deleted = false;
          throw e;
        }
      });
  });
}

// Utility
plugin.consistentModel = function (modelName, schema, ...other) {
  plugin(modelName, schema);
  return mongoose.model(modelName, schema, ...other);
};

plugin.SubRefConstraintError = SubRefConstraintError;
module.exports = plugin;
