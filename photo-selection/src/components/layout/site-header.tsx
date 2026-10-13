import { Brand } from "./brand";
import { Container } from "./container";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
      <Container className="flex h-16 items-center justify-between sm:h-20">
        <Brand />
      </Container>
    </header>
  );
}
