# Product Tagger - Shopify Embedded App

![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen) ![Shopify App](https://img.shields.io/badge/Shopify-App-blue) ![License](https://img.shields.io/badge/License-MIT-lightgrey)

A Shopify embedded app that allows you to easily manage tags for products in your store. Built with Node.js, React, and Prisma.

---

## Table of Contents

* [Features](#features)
* [Prerequisites](#prerequisites)
* [Installation](#installation)
* [Environment Setup](#environment-setup)
* [Running the App](#running-the-app)
* [Ngrok Setup](#ngrok-setup)
* [Shopify App Configuration](#shopify-app-configuration)
* [Accessing the App](#accessing-the-app)
* [License](#license)

---

## Features

* Bulk add tags to products in your Shopify store.
* Update existing tags on products.
* Remove tags from products.
* Dry run mode to simulate updates or removals without applying changes.
* Filter products by keyword, product type, collection, or any combination of these.
* Embedded UI for easy product filtering.
* Supports multiple product types.
* Preview of filtered products.
* Built with modern Node.js, React, Polaris and Prisma stack.

---

## Prerequisites

* Node.js v18+
* npm
* Ngrok
* [Shopify CLI](https://shopify.dev/cli)
* Shopify Partner account and dev store

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/p2c6/product-tagger.git
cd product-tagger
npm install
npx prisma generate
npm run build
```

---

## Environment Setup

Create a `.env` file in the root directory and add the following:

```env
SHOPIFY_API_KEY=your-shopify-api-key
SHOPIFY_API_SECRET=your-shopify-api-secret
SCOPES=write_products,read_products
SHOPIFY_APP_URL=https://your-ngrok-link.ngrok-free.dev
```

> Replace the values with your Shopify credentials and Ngrok URL.

---

## Running the App

Start Shopify app development:

```bash
shopify app dev
```

* Log in to your Shopify developer account when prompted.
* After preview links appear, terminate the process (Ctrl + C).

Rebuild and start the app:

```bash
npm run build
npm start
```

---

## Ngrok Setup

In a separate terminal, run:

```bash
ngrok http 3000
```

> Use the public URL provided by Ngrok for your Shopify app configuration.

---

## Shopify App Configuration

Update your `shopify.app.toml` file:

```toml
application_url = "https://your-ngrok-link.ngrok-free.dev"
scopes = "write_products,read_products"
redirect_urls = [
  "https://your-ngrok-link.ngrok-free.dev/auth/admin/oauth/callback"
]
```

> Replace `https://your-ngrok-link.ngrok-free.dev` with your actual Ngrok URL.

---

## Accessing the App

1. Open your Ngrok URL in the browser.
2. Enter the Shopify store domain where you want to install the app.
3. Accept permissions and click **Install**.
4. Navigate to **Products** in the app and start tagging products.
5. You can perform the following operations on product tags:
   * Add a new tag
   * Update an existing tag
   * Remove a tag
   * Dry run mode for updating or removing tags to preview changes before applying
6. Filter products by keyword, product type, collection, or any combination for precise tagging.

---

## License

This project is licensed under the MIT License.
