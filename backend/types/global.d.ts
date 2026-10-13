// Types the whole backend shares. Only for the type checker – Node never loads this file.
import "express";

declare global {
  // routes throw errors with an HTTP status: Object.assign(new Error("…"), { status: 400 })
  interface Error {
    status?: number;
  }
}

declare module "express-serve-static-core" {
  interface Request {
    // the signed-in user, set by middleware/auth.js (a lean User with its permissions)
    user?: any;
  }
}
