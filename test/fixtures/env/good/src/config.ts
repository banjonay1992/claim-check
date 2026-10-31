export const config = {
  databaseUrl: process.env.DATABASE_URL,
  apiToken: process.env['API_TOKEN'],
  mode: process.env.NODE_ENV,
};

const { PORT = '3000' } = process.env;
export const port = Number(PORT);
