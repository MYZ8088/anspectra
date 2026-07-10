import { redirect } from "next/navigation";

export default function DocsForwarder(): never {
	redirect(process.env.NEXT_PUBLIC_DOCS_URL ?? "/");
}
