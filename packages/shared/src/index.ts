/**
 * @appsgain/shared — the types apps/web and apps/api both need, and nothing else.
 *
 * The rule for this package: it may describe the contract between the two, but it may
 * not contain behaviour. Anything with a dependency, a side effect or a decision in it
 * belongs to whichever app owns that decision.
 */
export * from "./roles";
export * from "./auth";
export * from "./tenant";
export * from "./permissions";
export * from "./lead-enums";
export * from "./call-enums";
