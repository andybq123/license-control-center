import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Chatizy · Central de Licenças" },
    { name: "description", content: "Central Chatizy de clientes, licenças e monitoramento de instalações." },
    { property: "og:title", content: "Chatizy · Central de Licenças" },
    { property: "og:description", content: "Gestão de clientes, chaves e instalações licenciadas." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: Index,
});

function Index() {
  return (
    <iframe
      title="Central de Licenças Chatizy — painel hospedado na VPS"
      src="https://licenca.chatizy.com.br"
      className="h-dvh w-full border-0"
    />
  );
}
