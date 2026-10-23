const noEmDashCopy = {
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
      Literal(node) {
        if (typeof node.value === "string" && /\u2014|&(?:mdash|#8212|#x2014);/i.test(node.value)) {
          context.report({ node, messageId: "noEmDash" });
        }
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
};

export default {
  meta: { name: "copy" },
  rules: { "no-em-dash-copy": noEmDashCopy },
};
