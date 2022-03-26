# Hoo Hacks Project 2022

<div id="top"></div>
<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

This repository is for Hoo Hacks 2022

### Built With

* [AWS Lambda](https://google.com)

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

This is an example of how you may give instructions on setting up your project locally.
To get a local copy up and running follow these simple example steps.

### Prerequisites

* pnpm
  <https://pnpm.io/installation>
* AWS CLI (version 2)
  <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>
* Terraform
  <https://learn.hashicorp.com/tutorials/terraform/install-cli>

### Installation

1. Clone the repo

   ```sh
   git clone https://github.com/a-n-u-b-i-s/repo_name.git
   ```

2. Install NPM packages

   ```sh
   pnpm install
   ```

3. Set up a code bucket for .tfstate files. If using the Intellibus code bucket, move to step 6.

4. Create s3 bucket inside the AWS management console. ENABLE BUCKET VERSIONING.
5. Modify deploy script to use this bucket name

    ```sh
    -backend-config="bucket=YOUR-BUCKET-NAME" \
    ```

6. Compile the typescript code

    ```sh
    pnpm run build
    ```

7. Deploy infrastructure. If on Windows, add `${LOCAL_PATH}\Git\bin\sh.exe` to PATH and run the deploy bash script using `sh`. Other OSes can simply run the deploy bash script directly, which will be what is shown in the following steps. This installation will use the development environment; the commands for production are similar.

8. Deploy messaging state

    ```sh
    ./deploy development messaging init
    ./deploy development messaging apply
    ```

9. Deploy compute state

    ```sh
    ./deploy development compute init
    ./deploy development compute apply
    ```

10. Deploy storage state

    ```sh
    ./deploy development storage init
    ./deploy development storage apply
    ```

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

After modifying src code for Lambda function deployment, run

```sh
pnpm run build
./deploy development compute apply
```

and commit with

```sh
git commit
```

to use the Husky githooks for linting, set up as best practices.

<!-- ROADMAP -->
## Roadmap

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Anubis - anubis@intellibus.com

<p align="right">(<a href="#top">back to top</a>)</p>
