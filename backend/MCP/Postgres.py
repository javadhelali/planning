from mcp.server.fastmcp import FastMCP

from databases.postgres import db

SUCCESS_MESSAGE = "Query executed successfully."
mcp = FastMCP("postgres")


@mcp.tool()
async def run_query(query: str) -> list[dict] | str:
    result = await db.execute(query)
    return result if result else SUCCESS_MESSAGE


if __name__ == "__main__":
    mcp.run()
