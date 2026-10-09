// Records the declared public schema chains. This is not schemastery and does
// not claim to implement its parser, loader, or reactive field lifecycle.
function node(kind, extra = {}) {
  return {
    kind, ...extra, volatileField: false, hasDefault: false,
    default(value) { this.hasDefault = true; this.defaultValue = value; return this },
    volatile() { this.volatileField = true; return this },
    min(value) { this.minimum = value; return this },
    max(value) { this.maximum = value; return this },
  }
}

export default {
  boolean: () => node('boolean'),
  number: () => node('number'),
  string: () => node('string'),
  array: (item) => node('array', { item }),
  union: (choices) => node('union', { choices }),
  object: (fields) => node('object', { fields }),
}
