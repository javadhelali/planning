from mcp.server.fastmcp import FastMCP

from databases.postgres import db

mcp = FastMCP("postgres")


@mcp.tool(
    title="Run Fetch Query",
    description=(
        "Run a SQL query that returns rows, such as SELECT or statements with RETURNING."
    ),
)
async def run_fetch(query: str) -> list[dict]:
    rows = await db.execute(query)
    return rows or []


@mcp.tool(
    title="Run Execute Statement",
    description=(
        "Run a SQL statement that does not return rows, such as CREATE, ALTER, or writes without RETURNING."
    ),
)
async def run_execute(query: str) -> str:
    await db.execute(query)
    return "Query executed successfully."


if __name__ == "__main__":
    mcp.run()
