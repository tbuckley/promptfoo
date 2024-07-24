# Using Vertex AI Models with Promptfoo

## Prerequisites

1. Install Google's official auth client as a peer dependency:

   ```sh
   npm i google-auth-library
   ```

2. Enable the Vertex AI API for your project in Google Cloud Console.

3. Set your Google Cloud project:

   ```sh
   gcloud config set project PROJECT_ID
   ```

4. Authenticate with Google Cloud using one of these methods:
   - Log in with `gcloud auth application-default login`
   - Use a machine with a service account that has the appropriate role
   - Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of a service account credentials file

## Configuration

Edit the `promptfooconfig.yaml` file to configure your evaluation settings.

## Running the Evaluation

Execute the evaluation:

```sh
promptfoo eval
```

## Viewing Results

To view the evaluation results:

```sh
promptfoo view
```
