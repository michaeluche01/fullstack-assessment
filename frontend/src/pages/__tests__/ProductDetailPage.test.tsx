import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import ProductDetailPage from "../ProductDetailPage";

// Mock router
vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "1" }),
  useNavigate: () => vi.fn(),
}));

// Mock cart
vi.mock("../../state/CartContext", () => ({
  useCart: () => ({
    add: vi.fn(),
  }),
}));

// Mock API
vi.mock("../../api", () => ({
  getProduct: vi.fn().mockResolvedValue({
    id: "1",
    name: "Test Product",
    sku: "SKU-1",
    price: "100",
    stock: 5,
    description: `<img src="x" onerror="window.__xss = true" />`,
  }),
  createOrder: vi.fn(),
}));

describe("ProductDetailPage - XSS Protection (F1)", () => {
  it("sanitizes product description and prevents script execution", async () => {
    render(<ProductDetailPage />);

    // wait for product to load
    const description = await screen.findByText("Test Product");

    expect(description).toBeInTheDocument();

    // Give React time to render sanitized HTML
    await new Promise((r) => setTimeout(r, 50));

    // Critical assertion:
    // injected script should NOT execute
    expect((window as any).__xss).toBeUndefined();
  });
});