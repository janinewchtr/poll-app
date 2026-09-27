# Poll App

Poll App is a responsive Angular project for creating, answering and reviewing surveys.
The app uses Supabase as a backend and stores surveys and submitted votes without user
authentication.

## Features

- Create surveys with title, description, category, deadline and dynamic questions
- Add single-choice and multiple-choice questions
- Limit answer options to six per question
- Answer active surveys
- Display survey results with percentage bars
- Update results through Supabase realtime subscriptions
- Filter surveys by category
- Show active and past surveys separately
- Responsive layout for desktop, tablet and mobile views

## Tech Stack

- Angular
- TypeScript
- SCSS
- Supabase
- Reactive Forms

## Project Setup

Install the dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm start
```

Open the app in the browser:

```text
http://localhost:4200/
```

## Build

Create a production build:

```bash
npm run build
```

The build output is created in the `dist/` folder.

## Supabase

The app expects two Supabase tables:

- `surveys`
- `votes`

The public Supabase URL and anon key are configured in:

```text
src/environments/environment.ts
```

The anon key is intended for frontend usage. A Supabase service role key must never be
committed to this project.
