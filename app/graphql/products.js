
  const products = `#graphql
  query GetProducts {
    products(first: 10) {
      nodes {
        id
        title
      }
    }
  }
`;
const graphql = {
    products,
};

export default graphql;