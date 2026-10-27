import { redirect } from "next/navigation";

/** Pictures for emails now live in Automation, next to the messages that use them. */
export default function ImagesRedirect() {
  redirect("/automation/images");
}
