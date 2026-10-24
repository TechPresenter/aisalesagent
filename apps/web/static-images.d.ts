// Next's declarations for static image imports (`import logo from "…/logo.png"`).
// next-env.d.ts normally supplies them, but `next dev` and `next build` generate that file
// and it is gitignored, so a clean checkout (CI's typecheck) does not have it and every
// image import fails to resolve. Referencing them here keeps `tsc --noEmit` independent
// of whether next has run on this machine.
/// <reference types="next/image-types/global" />
