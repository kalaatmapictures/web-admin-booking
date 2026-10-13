import { Container } from "./container";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <Container className="flex flex-col gap-1 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Kalaatma Pictures</p>
        <p>Foto asli tetap tersimpan aman di penyimpanan Kalaatma.</p>
      </Container>
    </footer>
  );
}
