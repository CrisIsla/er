/**
 * The path the app is served under, when it is not the site's root: the
 * study lives at https://erdoc.dcc.uchile.cl/evaluacion-er/.
 *
 * Next prefixes its own routing -- links, the router, its assets -- with the
 * `basePath` in next.config.js, but not a URL the code writes out itself: a
 * fetch of an API route, or an image under public/. Those go through here.
 * Set at build time, as NEXT_PUBLIC_BASE_PATH; empty at the root.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const withBasePath = (path: string): string => `${BASE_PATH}${path}`;
