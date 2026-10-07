import { BrowserRouter, Route, Routes } from 'react-router';
import { PublicLayout } from './layouts/PublicLayout';
import { HomePage } from './pages/HomePage';
import { ShopPage } from './pages/ShopPage';
import { ProductPage } from './pages/ProductPage';
import { AboutPage } from './pages/AboutPage';
import { SizeGuidePage } from './pages/SizeGuidePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminLoginPage } from './admin/AdminLoginPage';
import { RequireAdmin } from './admin/RequireAdmin';
import { AdminLayout } from './admin/AdminLayout';
import { AdminProductsPage } from './admin/AdminProductsPage';
import { EditProductPage, NewProductPage } from './admin/ProductEditorPage';

/** The route table. Tests render this inside a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<RequireAdmin />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminProductsPage />} />
          <Route path="products/new" element={<NewProductPage />} />
          <Route path="products/:id" element={<EditProductPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="shirts/:slug" element={<ProductPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="size-guide" element={<SizeGuidePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
