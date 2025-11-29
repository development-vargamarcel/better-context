import { TaggedError } from "effect/Data";

export class GeneralError extends TaggedError("GeneralError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class OcError extends TaggedError("OcError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ConfigError extends TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
