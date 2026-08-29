// Load order matters: the development file may intentionally override database
// values while the production-local file supplies shared cloud media settings.
process.env.NODE_ENV = "development";
process.env.PUBLIC_ORIGIN = "http://127.0.0.1:5173";
process.env.VENDOR_ORIGIN = "http://127.0.0.1:5174";
process.env.VENDOR_APP_URL = "http://127.0.0.1:5174/";

// Local API startup does not need push credentials. Ignore partially configured
// values so they cannot prevent Admin/Vendor order testing from starting.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

await import("../server/index.js");
