import SwiftUI
import AppKit

struct NativeUsage: View {
    let kind: ExampleKind
    let regular: Bool
    let tint: ReferenceTint
    let stepped: Bool
    let controlAPI: String
    @State private var copied = false
    private var glass: String { ".\(regular ? "regular" : "clear")\(tint == .none ? "" : ".tint(.\(tint.rawValue.lowercased()))")" }
    private var snippet: String {
        switch kind {
        case .surface: "content\n    .padding(20)\n    .frame(width: 280)\n    .glassEffect(\(glass).interactive(),\n                 in: .rect(cornerRadius: 38))"
        case .buttons: "Button(\"Get started\", systemImage: \"arrow.up.right\") { }\n    .buttonStyle(.glass)\n    .buttonBorderShape(.capsule)\n    .controlSize(.large)"
        case .toolbar: "@State private var showPlayback = false\n\nButton(showPlayback ? \"Hide playback\" : \"Show playback\") {\n    showPlayback.toggle()\n}\n.buttonStyle(.glass)\n.buttonBorderShape(.capsule)\n\nContentView()\n    .toolbar {\n        if showPlayback {\n            ToolbarItemGroup {\n                Button(\"Play\", systemImage: \"play\") { }\n                Button(\"Volume\", systemImage: \"speaker.wave.3\") { }\n            }\n            ToolbarSpacer(.fixed)\n            ToolbarItem {\n                Button(\"Favorite\", systemImage: \"heart\") { }\n            }\n        }\n    }"
        case .tabs: "let tabs = NSSegmentedControl(\n    labels: [\"Listen\", \"Browse\", \"Library\"],\n    trackingMode: .selectOne,\n    target: coordinator, action: #selector(selectTab)\n)\ntabs.controlSize = .large\ntabs.borderShape = .capsule\nif #available(macOS 27.0, *) {\n    tabs.role = .tabs\n}\ntabs.selectedSegment = 0"
        case .menu: "Menu(\"Options\", systemImage: \"ellipsis\") {\n    Button(\"Save to library\", systemImage: \"heart\") { }\n    Menu(\"Share\") {\n        Button(\"Copy link\") { }\n        Button(\"Email\") { }\n    }\n    Button(\"Download\", systemImage: \"arrow.down.circle\") { }\n}\n.menuStyle(.automatic)\n.controlSize(.large)"
        case .slider:
            controlAPI == "AppKit" ? "let slider = NSSlider(value: 50, minValue: 0, maxValue: 100,\n                      target: coordinator, action: #selector(changed))\nslider.isContinuous = true\nslider.numberOfTickMarks = \(stepped ? 5 : 0)\nslider.allowsTickMarkValuesOnly = \(stepped)" : "@State private var value = 50.0\n\nSlider(value: $value, in: 0...100\(stepped ? ", step: 25" : "")) {\n    Text(\"Slider\")\n}\n.labelsHidden()\n.frame(width: 280)"
        case .toggle:
            controlAPI == "AppKit" ? "let toggle = NSSwitch()\ntoggle.state = .on\ntoggle.target = coordinator\ntoggle.action = #selector(changed)" : "@State private var enabled = true\n\nToggle(\"Switch\", isOn: $enabled)\n    .toggleStyle(.switch)\n    .labelsHidden()"
        case .progressive: "ScrollView {\n    content\n}\n.scrollEdgeEffectStyle(.soft, for: [.top, .bottom])\n.safeAreaBar(edge: .top) { header }\n.safeAreaBar(edge: .bottom) { controls }\n\n// Disable the system scroll-edge effect:\n// .scrollEdgeEffectHidden()"
        }
    }
    private var limitation: String {
        switch kind {
        case .menu: "SwiftUI Menu uses the system popup, including its material, placement, animation, and keyboard navigation. Choose a submenu and a standalone or window-toolbar trigger. Menu actions are local previews, as on the website."
        case .slider, .toggle: "SwiftUI and AppKit controls use their system material. Clear/Regular is unavailable for their thumbs. SwiftUI accepts tint; AppKit NSSlider and NSSwitch use the system accent color. Select the API in Customize demo."
        case .progressive: "Apple exposes soft and hard scroll-edge styles, not a numeric blur radius or refraction setting. Image uses NSVisualEffectView with a public Core Animation mask; it is a system material fade rather than a variable-radius blur."
        case .surface: "Move drags the player within its scene. Anchor keeps it centered. Apple owns the interactive glass response; it does not expose the web library’s drag-stretch parameters."
        case .toolbar: "Playback starts hidden. The preview button shows or hides ToolbarItemGroup and ToolbarSpacer in the actual window toolbar. Apple owns its glass, grouping, sizing, and placement. The preview’s variant changes that toolbar; it does not draw a custom toolbar inside the scene."
        case .tabs: "NSSegmentedControl supplies a standalone capsule tab selector, without TabView’s content bezel. macOS 27 adds the tabs role for native tab navigation rendering. macOS 26 uses the standard segmented control. Apple owns its appearance, accent color, sizing, and keyboard interaction."
        case .buttons: "The standard Button uses Apple’s glass button style. Its material and interaction come from the system; Clear/Regular is not a property of this button style."
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 32) {
            codeSection("Installation", text: "bun run native\n# Requires macOS 26+, Xcode, and Apple Silicon.")
            codeSection("Usage", text: "import SwiftUI\nimport AppKit\n\n\(snippet)")
            VStack(alignment: .leading, spacing: 12) {
                Text("Native API").font(referenceFont(18, .medium))
                Text(limitation).font(referenceFont(13)).foregroundStyle(.secondary).lineSpacing(6)
                Link("Apple Liquid Glass documentation", destination: URL(string: "https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views")!)
                    .font(referenceFont(13))
            }
        }.frame(maxWidth: 740, alignment: .leading)
    }
    private func codeSection(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(referenceFont(20, .medium))
            ScrollView(.horizontal) {
                Text(text).font(.system(size: 13, design: .monospaced)).lineSpacing(6).textSelection(.enabled)
                    .padding(16).padding(.trailing, 32).frame(maxWidth: .infinity, alignment: .leading)
            }.background(Color.primary.opacity(0.04), in: .rect(cornerRadius: 12))
                .overlay(alignment: .topTrailing) {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(text, forType: .string)
                        copied = true
                    } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc") }
                        .buttonStyle(.plain).padding(12).accessibilityLabel("Copy code")
                }
        }
    }
}
