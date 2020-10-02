module.exports = class SubRefConstraintError extends Error {
    constructor(options) {
      super();
      this.options = options;
    }
  };
  