import { defineRule } from "vite-plus/lint/plugins";

export default defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Keep em dashes out of written copy." },
    schema: [],
    messages: {
      noEmDash: "Avoid em dashes in copy. Use a comma, colon, parentheses, or a new sentence.",
    },
  },
  create(context) {
    return {
      "Literal[value=/\\u2014|&(?:mdash|#8212|#x2014);/i]"(node) {
        context.report({ node, messageId: "noEmDash" });
      },
      TemplateElement(node) {
        if (/\u2014/.test(node.value.cooked ?? node.value.raw)) {
          context.report({ node, messageId: "noEmDash" });
        }
      },
      JSXText(node) {
        if (/\u2014|&(?:mdash|#8212|#x2014);/i.test(node.value)) {
          context.report({ node, messageId: "noEmDash" });
        }
      },
    };
  },
});
