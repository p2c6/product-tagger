import { useFetcher, useLoaderData, useSearchParams } from "react-router"; 
import { authenticate } from "../shopify.server"; 
import { useState, useEffect, useRef } from "react";

// ------------------------ HELPERS ------------------------

// Sanitize input for GraphQL query strings
const sanitizeQueryString = (str) =>
  String(str || "").replace(/["\\]/g, '\\$&').trim();

// Validate Shopify cursor
const isValidCursor = (cursor) => /^[A-Za-z0-9+/=]*$/.test(cursor);

// Escape text for UI rendering
const escapeHtml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// ------------------------ LOADER ------------------------
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") === "prev" ? "prev" : "next";
  const keyword = sanitizeQueryString(url.searchParams.get("keyword"));
  const productType = sanitizeQueryString(url.searchParams.get("productType"));
  const collection = url.searchParams.get("collection") || null;

  let collectionProductIds = [];
  if (collection) {
    try {
      const collectionQuery = await admin.graphql(
        `
        query GetCollectionProducts($id: ID!) {
          collection(id: $id) {
            products(first: 250) {
              nodes { id }
            }
          }
        }
        `,
        { variables: { id: collection } }
      );

      const collectionJson = await collectionQuery.json();
      collectionProductIds = collectionJson?.data?.collection?.products?.nodes?.map(
        (p) => p.id.replace("gid://shopify/Product/", "")
      ) || [];
    } catch (err) {
      console.error("Error fetching collection products:", err);
    }
  }

  const productFilters = [];
  if (keyword) productFilters.push(`title:*${keyword}*`);
  if (productType) productFilters.push(`product_type:${productType}`);
  if (collectionProductIds.length > 0) {
    const idFilters = collectionProductIds.map((id) => `id:${id}`).join(" OR ");
    productFilters.push(`(${idFilters})`);
  }

  const queryString = productFilters.length ? productFilters.join(" AND ") : null;

  const paginationArgs =
    direction === "prev" && cursor && isValidCursor(cursor)
      ? `last: 10, before: "${cursor}"`
      : cursor && isValidCursor(cursor)
      ? `first: 10, after: "${cursor}"`
      : `first: 10`;

  const finalArgs = queryString
    ? `${paginationArgs}, query: "${queryString}"`
    : paginationArgs;

  try {
    const response = await admin.graphql(`
      query GetProductsAndCollections {
        products(${finalArgs}) {
          nodes {
            id
            title
            tags
            productType
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }

        productsCount${queryString ? `(query: "${queryString}")` : ""} {
          count
        }

        collections(first: 100) {
          nodes {
            id
            title
            handle
          }
        }
      }
    `);

    const json = await response.json();

    return {
      products: json.data.products,
      totalCount: json.data.productsCount?.count || 0,
      collections: json.data.collections?.nodes || [],
      filters: { keyword, productType, collection },
    };
  } catch (err) {
    console.error("Error fetching products:", err);
    return {
      products: { nodes: [], pageInfo: {} },
      totalCount: 0,
      collections: [],
      filters: { keyword, productType, collection },
      error: "Failed to load products.",
    };
  }
};

// ------------------------ ACTION ------------------------
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "apply-tag") return null;

  const tag = sanitizeQueryString(formData.get("tag"));
  if (!tag) return { error: "Tag cannot be empty" };

  const keyword = sanitizeQueryString(formData.get("keyword"));
  const productType = sanitizeQueryString(formData.get("productType"));
  const collection = formData.get("collection") || null;
  const dryRun = formData.get("dryRun") === "true";
  const mode = formData.get("mode") === "remove" ? "remove" : "apply";
  const actionWord = mode === "remove" ? "removed" : "applied";

  let collectionProductIds = [];
  if (collection) {
    try {
      const collectionQuery = await admin.graphql(
        `
        query GetCollectionProducts($id: ID!) {
          collection(id: $id) {
            products(first: 250) {
              nodes { id }
            }
          }
        }
        `,
        { variables: { id: collection } }
      );
      const collectionJson = await collectionQuery.json();
      collectionProductIds = collectionJson?.data?.collection?.products?.nodes?.map(
        (p) => p.id.replace("gid://shopify/Product/", "")
      ) || [];
    } catch (err) {
      console.error("Error fetching collection products:", err);
    }
  }

  const productFilters = [];
  if (keyword) productFilters.push(`title:*${keyword}*`);
  if (productType) productFilters.push(`product_type:${productType}`);
  if (collectionProductIds.length > 0) {
    const idFilters = collectionProductIds.map((id) => `id:${id}`).join(" OR ");
    productFilters.push(`(${idFilters})`);
  }

  const queryString = productFilters.length ? productFilters.join(" AND ") : null;

  let cursor = null;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const dryRunSamples = [];

  try {
    do {
      const paginationArgs = cursor
        ? `first: 50, after: "${cursor}"${queryString ? `, query: "${queryString}"` : ""}`
        : `first: 50${queryString ? `, query: "${queryString}"` : ""}`;

      const response = await admin.graphql(`
        query GetProducts {
          products(${paginationArgs}) {
            nodes { id title tags }
            pageInfo { hasNextPage endCursor }
          }
        }
      `);

      const json = await response.json();
      const products = json.data.products?.nodes || [];
      const pageInfo = json.data.products?.pageInfo || { hasNextPage: false };

      for (const product of products) {
        const hasTag = product.tags.includes(tag);
        if ((mode === "apply" && hasTag) || (mode === "remove" && !hasTag)) {
          skipped++;
          continue;
        }

        if (dryRun) {
          dryRunSamples.push(product.title || product.id);
          updated++;
          continue;
        }

        try {
          const newTags =
            mode === "apply"
              ? [...product.tags, tag]
              : product.tags.filter((t) => t !== tag);

          const mutation = await admin.graphql(
            `
            mutation UpdateProductTags($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id tags }
                userErrors { field message }
              }
            }
            `,
            { variables: { input: { id: product.id, tags: newTags } } }
          );

          const mutationJson = await mutation.json();
          if (mutationJson.data.productUpdate?.userErrors?.length > 0) failed++;
          else updated++;
        } catch (err) {
          console.error("Error updating product:", err);
          failed++;
        }
      }

      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (cursor);
  } catch (err) {
    console.error("Error during action processing:", err);
  }

  return {
    success: true,
    updated,
    skipped,
    failed,
    dryRun,
    actionWord,
    dryRunSamples: dryRun ? dryRunSamples.slice(0, 100) : undefined,
  };
};

// ------------------------ COMPONENT (UI) ------------------------
export default function Products() {
  const fetcher = useFetcher();
  const { products, totalCount, collections, filters, error } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [keyword, setKeyword] = useState(filters.keyword);
  const [productType, setProductType] = useState(filters.productType);
  const [collection, setCollection] = useState(filters.collection);
  const [tag, setTag] = useState("");
  const [message, setMessage] = useState(null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(null);
  const [mode, setMode] = useState("apply");

  useEffect(() => {
    if (fetcher.data?.success) {
      const { updated, skipped, failed, dryRun, dryRunSamples, actionWord } = fetcher.data;
      setMessage({
        tone: dryRun ? "info" : "success",
        text: dryRun
          ? `Dry run: ${updated} would be ${actionWord}, ${skipped} skipped, ${failed} failed (simulated).`
          : `${updated} ${actionWord}, ${skipped} skipped, ${failed} failed.`,
        samples: dryRunSamples || [],
      });
      setProgress(100);
      if (progressRef.current) clearInterval(progressRef.current);
      const t = setTimeout(() => setProgress(0), 1500);
      return () => clearTimeout(t);
    } else if (fetcher.data?.error) {
      setMessage({ tone: "critical", text: fetcher.data.error });
      setProgress(0);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (fetcher.state === "submitting") {
      setProgress(3);
      if (progressRef.current) clearInterval(progressRef.current);
      progressRef.current = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) {
            clearInterval(progressRef.current);
            progressRef.current = null;
            return 90;
          }
          return Math.min(90, p + Math.random() * 8 + 2);
        });
      }, 350);
    } else {
      if (!fetcher.data) {
        setProgress(0);
        if (progressRef.current) clearInterval(progressRef.current);
      }
    }
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
      progressRef.current = null;
    };
  }, [fetcher.state]);

  const handlePreview = () => {
    const params = new URLSearchParams();
    if (keyword) params.set("keyword", keyword);
    if (productType) params.set("productType", productType);

    if (collection) {
      params.set("collection", collection);
    } else {
      params.delete("collection");
    }

    setSearchParams(params);
  };

  const handleApplyTag = () => {
    if (!tag.trim()) {
      setMessage({ tone: "warning", text: "Please enter a tag to apply" });
      return;
    }
    setMessage(null);
    setProgress(1);

    const form = new FormData();
    form.set("intent", "apply-tag");
    form.set("tag", tag);
    if (keyword) form.set("keyword", keyword);
    if (productType) form.set("productType", productType);
    if (collection) form.set("collection", collection);
    form.set("mode", mode);
    if (isDryRun) form.set("dryRun", "true");

    fetcher.submit(form, { method: "post" });
  };

  const goToPage = (cursor, direction) => {
    if (!isValidCursor(cursor)) return;
    const params = new URLSearchParams(searchParams);
    params.set("cursor", cursor);
    params.set("direction", direction);
    setSearchParams(params);
  };

  const isLoading = fetcher.state === "submitting";

return (
    <s-page heading="Product Tagger">
      {error && <s-banner heading={error} tone="critical" />}
      {message && (
        <s-banner
          heading={message.text}
          tone={message.tone}
          dismissible
          onDismiss={() => setMessage(null)}
        >
          {message.samples?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Sample products (dry run):</strong>
              <ul style={{ marginTop: 8, maxHeight: 160, overflow: "auto", paddingLeft: 16 }}>
                {message.samples.map((t, idx) => (
                  <li key={idx} style={{ fontSize: 13 }}>{escapeHtml(t)}</li>
                ))}
              </ul>
            </div>
          )}
        </s-banner>
      )}

      {progress > 0 && (
        <div style={{ margin: "12px 0" }}>
          <div style={{ height: 8, background: "#e6e6e6", borderRadius: 4, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, Math.round(progress))}%`,
                height: "100%",
                background: "#0b74de",
                transition: "width 300ms linear",
              }}
            />
          </div>
        </div>
      )}

      {isLoading && (
        <s-banner heading="Applying tags..." tone="info">
          Applying tags — please wait. This can take a while for large catalogs.
        </s-banner>
      )}

      <s-layout>
        <s-layout-section>
          <s-section heading="Filters">
            <s-box padding="400">
              <s-block-stack gap="400">
                <s-inline-stack gap="400" wrap>
                  <s-box minWidth="200px">
                    <s-text-field
                      label="Keyword (title contains)"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="e.g., Shirt"
                    />
                  </s-box>
                  <s-box minWidth="200px">
                    <s-text-field
                      label="Product Type"
                      value={productType}
                      onChange={(e) => setProductType(e.target.value)}
                      placeholder="e.g., Clothing"
                    />
                  </s-box>
                  <s-box minWidth="200px">
                   <s-select
                    label="Collection"
                    value={collection || ""}
                    onChange={(e) => {
                        const value = e.target.value;
                        setCollection(value || null); // null if empty string
                    }}
                    >
                    <s-option value="">All Collections</s-option>
                    {collections.map((c) => (
                        <s-option key={c.id} value={c.id}>{c.title}</s-option>
                    ))}
                    </s-select>

                  </s-box>
                  <s-box minWidth="200px">
                    <s-text-field
                      label="Tag"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="e.g., Free Ship"
                    />
                  </s-box>
                  <s-box minWidth="200px">
                    <s-select
                      label="Mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <s-option value="apply">Apply Tag</s-option>
                      <s-option value="remove">Remove Tag</s-option>
                    </s-select>
                  </s-box>
                </s-inline-stack>

                <s-inline-stack gap="300" align="center">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      id="dryRun"
                      type="checkbox"
                      checked={isDryRun}
                      onChange={(e) => setIsDryRun(e.target.checked)}
                    />
                    <label htmlFor="dryRun" style={{ fontSize: 13 }}>
                      Dry run (simulate — do not change products)
                    </label>
                  </div>

                  <s-inline-stack gap="300">
                    <s-button variant="secondary" onClick={handlePreview}>
                      Preview Matches
                    </s-button>
                    <s-button
                    variant="secondary"
                    onClick={() => {
                        setKeyword("");
                        setProductType("");
                        setCollection("");
                        setSearchParams(new URLSearchParams());
                        setMessage(null);
                    }}
                    >
                    Reset Preview
                    </s-button>
                    <s-button
                      variant="primary"
                      onClick={handleApplyTag}
                      disabled={isLoading}
                    >
                      {isDryRun
                        ? `Dry run: ${mode === "remove" ? "Remove Tag" : "Apply Tag"}`
                        : mode === "remove" ? "Remove Tag" : "Apply Tag"}
                    </s-button>
                  </s-inline-stack>
                </s-inline-stack>
              </s-block-stack>
            </s-box>
          </s-section>
        </s-layout-section>

        <s-layout-section>
          <s-card>
            <s-box padding="400">
              <s-block-stack gap="400">
                <s-inline-stack align="space-between">
                  <s-text variant="headingMd">Preview Results</s-text>
                  <s-badge tone="info">{totalCount} products</s-badge>
                </s-inline-stack>

                <s-table>
                  <s-table-header-row>
                    <s-table-header>Product Title</s-table-header>
                    <s-table-header>Current Tags</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {products?.nodes.map((product) => (
                      <s-table-row key={product.id}>
                        <s-table-cell>{product.title}</s-table-cell>
                        <s-table-cell>{product.tags.join(", ") || "—"}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>

                <s-inline-stack gap="300" align="center">
                  <s-button
                    disabled={!products?.pageInfo?.hasPreviousPage}
                    onClick={() => goToPage(products.pageInfo.startCursor, "prev")}
                  >
                    Previous
                  </s-button>
                  <s-button
                    disabled={!products?.pageInfo?.hasNextPage}
                    onClick={() => goToPage(products.pageInfo.endCursor, "next")}
                  >
                    Next
                  </s-button>
                </s-inline-stack>
              </s-block-stack>
            </s-box>
          </s-card>
        </s-layout-section>
      </s-layout>
    </s-page>
  );
}
