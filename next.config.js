const { getHighlighter, BUNDLED_LANGUAGES } = require("shiki");

const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./docs.config.tsx",
  mdxOptions: {
    rehypePrettyCodeOptions: {
      getHighlighter: (options) =>
        getHighlighter({
          ...options,
          langs: [
            ...BUNDLED_LANGUAGES,
            // setup syntax highlighting for erdoc code blocks
            {
              id: "erdoc",
              scopeName: "source.erdoc",
              aliases: ["erdoc"],
              path: "../../public/erdoc_grammar.tmLanguage.json",
            },
          ],
        }),
    },
  },
});

module.exports = withNextra({
  // Where the app is served, when not at the site's root -- the study under
  // /evaluacion-er. The code's own URLs go through util/basePath.ts.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  // The Docker image runs the self-contained build (.next/standalone); a
  // plain `next start`, as pm2 runs it, does not want that output, so it is
  // only produced when the Dockerfile asks for it.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
});
