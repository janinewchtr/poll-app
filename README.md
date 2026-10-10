# Poll App

This is my final Angular project for the frontend developer course.

The app allows users to create surveys, answer existing surveys and view the results. Supabase is used as the backend. This version does not include user authentication.

## Tech Stack

- Angular
- TypeScript
- SCSS
- Supabase

## Features

- Create surveys
- Answer surveys
- Show survey results
- Filter surveys by category
- Realtime result updates
- Responsive layout
- Anonymous browser-local participant ids
- Environment-based Supabase configuration

## Setup

Clone the project and install the dependencies:

npm install

Create a local `.env` file in the project root. You can use `.env.example` as a template:

cp .env.example .env

Add your own Supabase project values to `.env`:

SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key

The Angular environment file is generated automatically from `.env` before starting or building the app.

Start the project locally:

npm start

Build the project:

npm run build

## Environment Files

The real `.env` file is ignored by Git and must not be committed.

The generated Angular environment file is also ignored:

src/environments/environment.ts

If the environment file is missing, run:

npm run set-env

## Important Notes

The Supabase anon key is used in the browser and is therefore visible in the built frontend. This is expected for frontend Supabase apps. Security must be handled with Supabase Row Level Security policies.

Do not store private service role keys in `.env` for this frontend app.