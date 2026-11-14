# Homebrew formula for Schema — architecture graph MCP server.
# Install: brew install schema-ai/tap/schema
#
# Status: PENDING v1.0 release. This formula cannot be published to a
# tap until a stable npm tarball URL + SHA256 exists. The `url` and
# `sha256` fields below are placeholders.
#
# The formula wraps the npm package because Schema requires Node.js 22+.
# A compiled binary formula (no Node dependency) is a v1.1 follow-up.

class Schema < Formula
  desc "MCP-native architecture graph for codebases too large to vibe"
  homepage "https://schema.dev"
  # TODO: replace with actual npm tarball URL after `npm publish`
  url "https://registry.npmjs.org/@schema-ai/mcp/-/mcp-1.0.0.tgz"
  sha256 "PLACEHOLDER — run `shasum -a 256 mcp-1.0.0.tgz` after npm publish"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", "--prefix", libexec, "-g", "@schema-ai/mcp@#{version}"
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "schema", shell_output("#{bin}/schema --help")
    assert_match "Node.js", shell_output("#{bin}/schema doctor")
  end
end
