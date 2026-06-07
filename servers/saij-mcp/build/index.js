import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SaijMcpServer } from "./server.js";
async function main() {
    const server = new SaijMcpServer();
    const transport = new StdioServerTransport();
    await server.instance.connect(transport);
    console.error("SAIJ MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
