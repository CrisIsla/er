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
  // The Docker image runs the self-contained build (.next/standalone); a
  // plain `next start`, as pm2 runs it, does not want that output, so it is
  // only produced when the Dockerfile asks for it.
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
});
