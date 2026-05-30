export default async function handler(req, res) {
  res.json({
    TAVILY_KEY: process.env.TAVILY_API_KEY ? 
      process.env.TAVILY_API_KEY.slice(0, 12) + "..." : "MISSING",
    MISTRAL_KEY: process.env.MISTRAL_API_KEY ? 
      process.env.MISTRAL_API_KEY.slice(0, 12) + "..." : "MISSING",
  });
}
