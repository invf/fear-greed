// app/dashboard/page.tsx
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/"); // якщо CheckoutBox на головній
  // redirect("/checkout"); // якщо CheckoutBox на /checkout
}