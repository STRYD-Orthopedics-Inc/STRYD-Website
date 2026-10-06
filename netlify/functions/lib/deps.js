'use strict';
// Default dependency set. Handlers take a `deps` object so tests can inject fakes.
module.exports = {
  db: require('./db'),
  cio: require('./customerio'),
  ph: require('./posthog'),
  rate: require('./rateLimit'),
  now: () => Date.now(),
};
