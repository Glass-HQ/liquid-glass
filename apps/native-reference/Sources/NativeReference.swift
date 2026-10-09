import SwiftUI
import AppKit

@main
struct LiquidGlassReferenceApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene {
        Window("Liquid Glass Native Reference", id: "reference") {
            ReferenceView().frame(minWidth: 680, minHeight: 500)
        }
        .defaultSize(width: 1100, height: 900)
        .windowResizability(.contentMinSize)
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
func referenceFont(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight)
}
extension Color {
    init(hex: Int) {
        self.init(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
}
@MainActor
enum ReferenceImages {
    static let day = load("duo-day", ext: "jpg")
    static let night = load("duo-night", ext: "jpg")
    static func load(_ name: String, ext: String = "svg") -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext) else { return nil }
        return NSImage(contentsOf: url)
    }
}
enum ExampleKind: String, CaseIterable, Identifiable {
    case surface, buttons, toolbar, tabs, menu, slider, toggle = "switch", progressive = "progressive-blur"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .surface: "Surface"
        case .buttons: "Buttons"
        case .toolbar: "Toolbar"
        case .tabs: "Tab bar"
        case .menu: "Menu"
        case .slider: "Slider"
        case .toggle: "Switch"
        case .progressive: "Progressive blur"
        }
    }
    var navigationTitle: String {
        self == .tabs ? "Tab Bar" : self == .progressive ? "Progressive Blur" : title
    }
}
struct ReferenceView: View {
    @AppStorage("nativeTheme") private var theme = "system"
    @Environment(\.colorScheme) private var systemScheme
    @State private var route: String? = "all"
    private var dark: Bool { theme == "dark" || (theme == "system" && systemScheme == .dark) }
    var body: some View {
        NavigationSplitView {
            List(selection: $route) {
                Section("Getting Started") {
                    Label("Introduction", systemImage: "book.closed").tag("introduction")
                }
                Section("Examples") {
                    Label("All", systemImage: "square.grid.2x2").tag("all")
                    ForEach(ExampleKind.allCases) { kind in
                        Label(kind.navigationTitle, systemImage: kind.symbol).tag(kind.rawValue)
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Liquid Glass")
            .navigationSplitViewColumnWidth(min: 180, ideal: 224, max: 300)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 52) {
                    if route == "introduction" { introduction }
                    else {
                        ForEach(ExampleKind.allCases.filter { route == "all" || route == $0.rawValue }) { kind in
                            NativeExample(kind: kind, dark: dark)
                        }
                    }
                }.padding(24).frame(maxWidth: 1040, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(route)
            .scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
            .navigationTitle(route == "all" ? "All examples" : route == "introduction" ? "Introduction" : ExampleKind(rawValue: route ?? "")?.title ?? "Liquid Glass")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Menu("Appearance", systemImage: "circle.lefthalf.filled") {
                        Picker("Appearance", selection: $theme) {
                            Label("Light", systemImage: "sun.max").tag("light")
                            Label("Dark", systemImage: "moon").tag("dark")
                            Label("System", systemImage: "desktopcomputer").tag("system")
                        }
                    }.help("Appearance")
                }
            }
        }
        .preferredColorScheme(theme == "system" ? nil : dark ? .dark : .light)
    }
    private var introduction: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Liquid Glass").font(.largeTitle.bold()).padding(.bottom, 6)
            Text("Apple’s Liquid Glass surfaces and controls, built with SwiftUI and AppKit. The examples use the same content and backgrounds as the website, with Apple’s standard navigation, tabs, menus, toolbars, buttons, sliders, and switches.")
            Text("Choose an example in the sidebar. Preview shows the native component; Install & Usage explains the Apple API. The Toolbar example can show playback controls in this window’s system toolbar.")
        }.lineSpacing(6).frame(maxWidth: 740, alignment: .leading).textSelection(.enabled)
    }
}
extension ExampleKind {
    var symbol: String {
        switch self {
        case .surface: "rectangle.on.rectangle"
        case .buttons: "button.horizontal"
        case .toolbar: "rectangle.topthird.inset.filled"
        case .tabs: "rectangle.bottomthird.inset.filled"
        case .menu: "list.bullet.rectangle"
        case .slider: "slider.horizontal.3"
        case .toggle: "switch.2"
        case .progressive: "square.stack.3d.up"
        }
    }
}
enum ReferenceTint: String, CaseIterable {
    case none = "No tint", blue = "Blue", purple = "Purple", pink = "Pink"
    case red = "Red", orange = "Orange", green = "Green", yellow = "Yellow"
    var color: Color? {
        switch self {
        case .none: nil
        case .blue: Color(hex: 0x007aff)
        case .purple: Color(hex: 0xaf52de)
        case .pink: Color(hex: 0xff2d55)
        case .red: Color(hex: 0xff3b30)
        case .orange: Color(hex: 0xff9500)
        case .green: Color(hex: 0x34c759)
        case .yellow: Color(hex: 0xffcc00)
        }
    }
}
struct NativeExample: View {
    let kind: ExampleKind
    let dark: Bool
    @State private var regular = false
    @State private var tint = ReferenceTint.none
    @State private var appearance = "Default"
    @State private var background = "Landscape"
    @State private var view = "Preview"
    @State private var toolbarVariant = "Normal"
    @State private var showPlaybackToolbar = false
    @State private var movable = true
    @State private var stepped = false
    @State private var controlAPI = "SwiftUI"
    @State private var menuOptions = NativeMenuOptions()
    @State private var progressiveMode = "Library"
    @State private var edge = "Bottom edge"
    @State private var edgeStyle = "Soft blur"
    private var isDark: Bool { appearance == "Default" ? dark : appearance == "Dark" }
    private var material: Glass { (regular ? Glass.regular : Glass.clear).tint(tint.color) }
    private var bottomControls: Bool { kind == .slider || kind == .menu || (kind == .toolbar && toolbarVariant == "With menu") }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: kind.symbol).font(.title2).foregroundStyle(.secondary)
                Text(kind.title).font(.title.bold())
            }.padding(.bottom, 20)
            Picker("View", selection: $view) {
                Text("Preview").tag("Preview")
                Text("Install & Usage").tag("Install & Usage")
            }.pickerStyle(.segmented).labelsHidden().fixedSize().padding(.bottom, 24)
            if view == "Preview" { preview }
            else { NativeUsage(kind: kind, regular: regular, tint: tint, stepped: stepped, controlAPI: controlAPI) }
        }
        .toolbar {
            if view == "Preview" && kind == .toolbar && showPlaybackToolbar {
                ToolbarItemGroup {
                    Button("Play", systemImage: "play") { }
                    Button("Volume", systemImage: "speaker.wave.3") { }
                }
                if toolbarVariant == "Fixed spacer" { ToolbarSpacer(.fixed) }
                if toolbarVariant == "Flexible spacer" { ToolbarSpacer(.flexible) }
                ToolbarItemGroup {
                    Button("Favorite", systemImage: "heart") { }
                    if toolbarVariant == "With menu" { NativeSwiftUIMenu(submenu: menuOptions.submenu) }
                }
            }
            if view == "Preview" && kind == .menu && menuOptions.toolbar {
                ToolbarItemGroup {
                    NativeSwiftUIMenu(submenu: menuOptions.submenu)
                }
            }
        }
        .onChange(of: dark) { appearance = "Default" }
    }
    private var preview: some View {
        GeometryReader { geometry in
            ZStack {
                if kind == .progressive {
                    NativeProgressiveScene(mode: progressiveMode, dark: isDark, material: material,
                                           edgeStyle: edgeStyle, edge: edge)
                } else {
                    NativeBackdrop(background: background, dark: isDark, size: geometry.size).allowsHitTesting(false)
                    GlassEffectContainer(spacing: 0) {
                        content(size: geometry.size)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.bottom, bottomControls ? 64 : 0)
                }
            }
            .clipShape(.rect(cornerRadius: 31))
            .overlay(alignment: .topTrailing) { customize.padding(12) }
            .overlay(alignment: .bottom) {
                if kind == .slider {
                    Picker("Slider behavior", selection: $stepped) {
                        Text("Continuous").tag(false)
                        Text("Stepped").tag(true)
                    }.pickerStyle(.segmented).labelsHidden().fixedSize().padding(.bottom, 24)
                } else if kind == .menu || (kind == .toolbar && toolbarVariant == "With menu") {
                    NativeMenuControls(options: $menuOptions, showsTrigger: kind == .menu).padding(.bottom, 24)
                }
            }
            .environment(\.colorScheme, isDark ? .dark : .light)
            .foregroundStyle(isDark ? Color(hex: 0xfff7e8) : Color(hex: 0x30271f))
        }.frame(height: kind == .surface ? 440 : 390)
    }
    @ViewBuilder private func content(size: CGSize) -> some View {
        switch kind {
        case .surface: DraggablePlayer(material: material, movable: movable, bounds: size)
        case .buttons:
            Button("Get started", systemImage: "arrow.up.right") { }
                .buttonStyle(.glass).buttonBorderShape(.capsule).controlSize(.large).tint(tint.color)
        case .toolbar:
            VStack(spacing: 12) {
                Label("Playback", systemImage: "rectangle.topthird.inset.filled").font(.headline)
                Button(showPlaybackToolbar ? "Hide playback from window toolbar" : "Show playback in window toolbar",
                       systemImage: "rectangle.topthird.inset.filled") {
                    showPlaybackToolbar.toggle()
                }.buttonStyle(.glass).buttonBorderShape(.capsule).controlSize(.large)
                Picker("Toolbar variant", selection: $toolbarVariant) {
                    ForEach(["Normal", "Fixed spacer", "Flexible spacer", "With menu"], id: \.self) { Text($0) }
                }.fixedSize()
            }
        case .tabs: NativeMusicTabs()
        case .menu:
            if menuOptions.toolbar { Text("Options is in the system window toolbar.").font(.callout) }
            else { NativeMenu(options: menuOptions) }
        case .slider, .toggle: NativeValueControls(kind: kind, tint: tint.color, stepped: stepped, api: controlAPI)
        case .progressive: EmptyView()
        }
    }
    private var customize: some View {
        Menu("Customize demo", systemImage: "slider.horizontal.3") {
            Picker("Material", selection: $regular) { Text("Clear").tag(false); Text("Regular").tag(true) }
                .disabled(kind != .surface && kind != .progressive)
            if kind == .progressive {
                Picker("Layout", selection: $progressiveMode) {
                    ForEach(["Library", "iMessage", "Article", "Image"], id: \.self) { Text($0) }
                }
                if progressiveMode == "Image" {
                    Picker("Edge", selection: $edge) { Text("Bottom edge").tag("Bottom edge"); Text("Top edge").tag("Top edge") }
                }
                Divider()
                Picker("Blur", selection: $edgeStyle) {
                    ForEach(["No blur", "Soft blur", "System blur"], id: \.self) { Text($0) }
                }
            } else {
                Picker("Tint color", selection: $tint) {
                    ForEach(ReferenceTint.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.disabled(kind == .menu || kind == .toolbar || kind == .tabs || ((kind == .slider || kind == .toggle) && controlAPI == "AppKit"))
                Picker("Background", selection: $background) {
                    ForEach(["Landscape", "Typography", "Test grid"], id: \.self) { Text($0) }
                }
            }
            Picker("Appearance", selection: $appearance) {
                Text("Light").tag("Light"); Text("Dark").tag("Dark"); Text("System").tag("Default")
            }
            if kind == .toolbar {
                Divider()
                Picker("Toolbar variant", selection: $toolbarVariant) {
                    ForEach(["Normal", "Fixed spacer", "Flexible spacer", "With menu"], id: \.self) { Text($0) }
                }
            }
            if kind == .surface {
                Divider()
                Picker("Dragging", selection: $movable) { Text("Move").tag(true); Text("Anchor").tag(false) }
            }
            if kind == .slider || kind == .toggle {
                Divider()
                Picker("Native API", selection: $controlAPI) { Text("SwiftUI").tag("SwiftUI"); Text("AppKit").tag("AppKit") }
            }
        }.menuStyle(.automatic).fixedSize().help("Customize demo")
    }
}
// A standalone system tab selector; TabView's macOS styles include a content bezel.
private struct NativeMusicTabs: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSSegmentedControl {
        let control = NSSegmentedControl(labels: ["Listen", "Browse", "Library"], trackingMode: .selectOne,
                                         target: context.coordinator, action: #selector(Coordinator.selectTab(_:)))
        control.controlSize = .large
        control.borderShape = .capsule
        if #available(macOS 27.0, *) { control.role = .tabs }
        control.selectedSegment = context.coordinator.selection
        control.setAccessibilityLabel("Music tabs")
        return control
    }
    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        control.selectedSegment = context.coordinator.selection
    }
    @MainActor final class Coordinator: NSObject {
        var selection = 0
        @objc func selectTab(_ sender: NSSegmentedControl) { selection = sender.selectedSegment }
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSSegmentedControl, context: Context) -> CGSize? {
        nsView.intrinsicContentSize
    }
}
struct NativeBackdrop: View {
    let background: String
    let dark: Bool
    let size: CGSize
    var body: some View {
        if background == "Landscape" {
            if let image = dark ? ReferenceImages.night : ReferenceImages.day {
                Image(nsImage: image).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
            }
        } else if background == "Typography" {
            ZStack(alignment: .topLeading) {
                dark ? Color(hex: 0x111111) : Color(hex: 0xfafafa)
                let fontSize = max(28, min(size.width * 0.08, size.height * 0.16, 96))
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(["ABCDEFGHIJKLMN", "OPQRSTUVWXYZ", "abcdefghijklm", "nopqrstuvwxyz", "0123456789 &→!"], id: \.self) { line in
                        Text(line).font(referenceFont(fontSize)).tracking(-fontSize * 0.045).fixedSize()
                            .frame(height: fontSize * 1.08, alignment: .leading)
                    }
                }.padding(24).foregroundStyle(dark ? Color(hex: 0xfafafa) : Color(hex: 0x111111))
            }
        } else {
            ZStack(alignment: .topLeading) {
                Canvas { context, bounds in
                    context.fill(Path(CGRect(origin: .zero, size: bounds)), with: .color(dark ? Color(hex: 0x24272d) : Color(hex: 0xfaf9f6)))
                    var grid = Path()
                    for x in stride(from: CGFloat(0), through: bounds.width, by: 24) { grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: bounds.height)) }
                    for y in stride(from: CGFloat(0), through: bounds.height, by: 24) { grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: bounds.width, y: y)) }
                    context.stroke(grid, with: .color(Color(hex: 0x292724)), lineWidth: 1)
                }
                HStack(spacing: 0) {
                    ForEach([0xa0c8f5, 0xefb59e, 0xd1daba, 0xdec1ec, 0xf0daab], id: \.self) { Color(hex: $0) }
                }.frame(height: size.height * 0.4).offset(y: size.height * 0.4)
                Text("Aa").font(referenceFont(190, .semibold)).tracking(-20)
                    .position(x: size.width * 0.3 + 100, y: size.height * 0.9 - 100)
            }
        }
    }
}
private struct DraggablePlayer: View {
    let material: Glass
    let movable: Bool
    let bounds: CGSize
    @State private var position: CGSize = .zero
    @GestureState private var translation: CGSize = .zero
    private func constrain(_ value: CGSize) -> CGSize {
        let x = max(0, (bounds.width - 280) / 2 - 12)
        let y = max(0, (bounds.height - 146) / 2 - 12)
        return CGSize(width: min(x, max(-x, value.width)), height: min(y, max(-y, value.height)))
    }
    var body: some View {
        let offset = constrain(CGSize(width: position.width + translation.width, height: position.height + translation.height))
        NativePlayer(material: material)
            .offset(movable ? offset : .zero)
            .simultaneousGesture(DragGesture(minimumDistance: 8)
                .updating($translation) { value, state, transaction in
                    transaction.animation = nil
                    if movable { state = value.translation }
                }.onEnded { value in
                    if movable { position = constrain(CGSize(width: position.width + value.translation.width, height: position.height + value.translation.height)) }
                })
            .onChange(of: movable) { position = .zero }
            .onChange(of: bounds) { position = constrain(position) }
    }
}
struct NativePlayer: View {
    let material: Glass
    @State private var liked = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ReferenceArtwork(url: ReferenceContent.shared.nowPlaying.art).frame(width: 36, height: 36).clipShape(.rect(cornerRadius: 13.5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ReferenceContent.shared.nowPlaying.title).font(referenceFont(13, .semibold))
                    Text(ReferenceContent.shared.nowPlaying.artist).font(referenceFont(11)).opacity(0.8)
                }
                Spacer(minLength: 0)
                Button { liked.toggle() } label: {
                    Image(systemName: liked ? "heart.fill" : "heart").frame(width: 24, height: 24)
                        .foregroundStyle(liked ? Color.pink : Color.primary)
                }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityLabel(liked ? "Unlike" : "Like")
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.primary.opacity(0.24))
                    Capsule().fill(.primary).frame(width: geometry.size.width * 0.34)
                }
            }.frame(height: 3).padding(.top, 18)
            HStack {
                Text("1:51")
                Spacer()
                Button {} label: { Image(systemName: "play").frame(width: 28, height: 28) }
                    .buttonStyle(.plain).accessibilityLabel("Play")
                Spacer()
                Text("5:31")
            }.font(referenceFont(10)).monospacedDigit().padding(.top, 8)
        }.padding(20).frame(width: 280)
            .glassEffect(material.interactive(), in: .rect(cornerRadius: 38))
    }
}
