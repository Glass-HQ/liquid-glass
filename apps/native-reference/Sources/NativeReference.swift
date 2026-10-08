import SwiftUI
import AppKit
import CoreText
import ImageIO

@main
struct LiquidGlassReferenceApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    init() {
        if let url = Bundle.main.url(forResource: "InterVariable", withExtension: "ttf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        _ = Wallpapers.day
        _ = Wallpapers.night
    }
    var body: some Scene {
        Window("Liquid Glass Native Reference", id: "reference") {
            ReferenceView().frame(minWidth: 820, minHeight: 600)
        }
        .defaultSize(width: 1040, height: 860)
        .windowResizability(.contentMinSize)
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}
@MainActor
private enum Wallpapers {
    static let day = load("duo-day")
    static let night = load("duo-night")
    private static func load(_ name: String) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg"),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2400,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else { return nil }
        return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
    }
}
struct ReferenceView: View {
    @AppStorage("nativeDarkAppearance") private var dark = false
    var body: some View {
        ScrollView {
            VStack(spacing: 52) {
                ForEach(["Slider", "Switch", "Surface", "Buttons & toolbar", "Tab bar", "Menu"], id: \.self) { kind in
                    NativeExample(kind: kind, dark: dark)
                }
            }.padding(32).frame(maxWidth: 1040)
                .frame(maxWidth: .infinity)
        }
        .font(.custom("InterVariable", size: 14))
        .background(dark ? Color(red: 0.098, green: 0.098, blue: 0.094) : Color(red: 0.98, green: 0.976, blue: 0.965))
        .preferredColorScheme(dark ? .dark : .light)
        .toolbar {
            Picker("Appearance", selection: $dark) {
                Text("Light").tag(false)
                Text("Dark").tag(true)
            }.pickerStyle(.segmented).frame(width: 120)
        }
    }
}
enum ReferenceTint: String, CaseIterable {
    case none = "No tint", blue = "Blue", purple = "Purple", pink = "Pink"
    case red = "Red", orange = "Orange", green = "Green", yellow = "Yellow"
    var color: Color? {
        let rgb: Int
        switch self {
        case .none: return nil
        case .blue: rgb = 0x007aff
        case .purple: rgb = 0xaf52de
        case .pink: rgb = 0xff2d55
        case .red: rgb = 0xff3b30
        case .orange: rgb = 0xff9500
        case .green: rgb = 0x34c759
        case .yellow: rgb = 0xffcc00
        }
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}
struct NativeExample: View {
    let kind: String
    let dark: Bool
    @State private var tint = ReferenceTint.none
    @State private var regular: Bool
    @State private var appearance: Bool? = nil
    @State private var background = "Landscape"
    @State private var selectedTab = "Listen"
    @State private var reset = 0
    @Namespace private var selection
    init(kind: String, dark: Bool) {
        self.kind = kind
        self.dark = dark
        _regular = State(initialValue: kind != "Surface")
    }
    private var isDark: Bool { appearance ?? dark }
    private var material: Glass { (regular ? Glass.regular : Glass.clear).tint(tint.color) }
    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Text(kind).font(.custom("InterVariable", size: 15).weight(.medium))
                Spacer()
                if !["Slider", "Switch"].contains(kind) {
                Picker("Material", selection: $regular) {
                    Text("Clear").tag(false)
                    Text("Regular").tag(true)
                }.pickerStyle(.segmented).frame(width: 150).labelsHidden()
                }
                Picker("Tint color", selection: $tint) {
                    ForEach(ReferenceTint.allCases, id: \.self) { value in
                        Text(value.rawValue).tag(value)
                    }
                }.pickerStyle(.menu).frame(width: 100).labelsHidden()
                Picker("Background", selection: $background) {
                    ForEach(["Landscape", "Typography", "Test grid"], id: \.self) { value in
                        Text(value).tag(value)
                    }
                }.pickerStyle(.menu).frame(width: 140).labelsHidden()
                Picker("Appearance", selection: Binding(get: { isDark }, set: { appearance = $0 })) {
                    Text("Light").tag(false)
                    Text("Dark").tag(true)
                }.pickerStyle(.menu).frame(width: 86).labelsHidden()
                if kind == "Surface" {
                    Button("Reset") { reset += 1 }.buttonStyle(.borderless)
                }
            }.zIndex(1)
            GeometryReader { geometry in
                ZStack {
                    NativeBackdrop(background: background, dark: isDark, size: geometry.size)
                        .allowsHitTesting(false)
                    GlassEffectContainer(spacing: 0) {
                        if kind == "Surface" {
                            DraggablePlayer(material: material, reset: reset)
                        } else if ["Slider", "Switch"].contains(kind) {
                            NativeValueControls(kind: kind, tint: tint.color)
                        } else if kind == "Buttons & toolbar" {
                            HStack(spacing: 30) {
                                Button {} label: {
                                    HStack(spacing: 12) { Text("Get started"); NativeIcon(kind: .arrow) }
                                        .padding(.horizontal, 24).frame(height: 52)
                                        .glassEffect(material.interactive(), in: .rect(cornerRadius: 28))
                                }.buttonStyle(.plain)
                                HStack(spacing: 4) {
                                    iconButton(.play, label: "Play")
                                    iconButton(.volume, label: "Volume")
                                    iconButton(.heart, label: "Favorite")
                                }.padding(6).glassEffect(material, in: .rect(cornerRadius: 34))
                            }
                        } else if kind == "Tab bar" {
                            HStack(spacing: 0) {
                                ForEach(["Listen", "Browse", "Library"], id: \.self) { tab in
                                    Button {
                                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                                            selectedTab = tab
                                        }
                                    } label: {
                                        Text(tab).font(.custom("InterVariable", size: 14).weight(.medium))
                                            .frame(width: 92, height: 44)
                                            .background {
                                                if selectedTab == tab {
                                                    Color.clear
                                                        .glassEffect(material.interactive(), in: .capsule)
                                                        .matchedGeometryEffect(id: "selected", in: selection)
                                                }
                                            }
                                    }.buttonStyle(.plain)
                                }
                            }.padding(5).glassEffect(material, in: .capsule)
                        } else {
                            NativeMenu(material: material)
                        }
                    }
                }.frame(width: geometry.size.width, height: geometry.size.height)
                    .clipShape(.rect(cornerRadius: 16))
                    .environment(\.colorScheme, isDark ? .dark : .light)
            }.frame(height: kind == "Surface" ? 440 : 390)
        }.onChange(of: dark) { appearance = nil }
    }
    private func iconButton(_ kind: GlassIconKind, label: String) -> some View {
        Button {} label: { NativeIcon(kind: kind).frame(width: 44, height: 44) }
            .buttonStyle(.plain).accessibilityLabel(label)
    }
}
private struct NativeBackdrop: View {
    let background: String
    let dark: Bool
    let size: CGSize
    var body: some View {
        if background == "Landscape" {
            if let image = dark ? Wallpapers.night : Wallpapers.day {
                Image(nsImage: image).resizable().scaledToFill().frame(width: size.width, height: size.height).clipped()
            }
        } else if background == "Typography" {
            ZStack(alignment: .topLeading) {
                (dark ? Color(white: 0.067) : Color(white: 0.98))
                let fontSize = max(28, min((size.width - 48) * 0.08, (size.height - 48) * 0.16, 96))
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(["ABCDEFGHIJKLMN", "OPQRSTUVWXYZ", "abcdefghijklm", "nopqrstuvwxyz", "0123456789 &→!"], id: \.self) { line in
                        Text(line).font(.custom("InterVariable", size: fontSize))
                            .tracking(-fontSize * 0.045).fixedSize()
                            .frame(height: fontSize * 1.08, alignment: .leading)
                    }
                }.padding(24).foregroundStyle(dark ? Color(white: 0.98) : Color(white: 0.067))
            }
        } else {
            Canvas { context, bounds in
                context.fill(Path(CGRect(origin: .zero, size: bounds)), with: .color(dark ? Color(white: 0.14) : Color(white: 0.98)))
                var grid = Path()
                for x in stride(from: CGFloat(0), through: bounds.width, by: 32) { grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: bounds.height)) }
                for y in stride(from: CGFloat(0), through: bounds.height, by: 32) { grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: bounds.width, y: y)) }
                context.stroke(grid, with: .color(dark ? .white.opacity(0.3) : .black.opacity(0.3)), lineWidth: 1)
            }
        }
    }
}
private struct DraggablePlayer: View {
    let material: Glass
    let reset: Int
    @State private var position: CGSize = .zero
    @GestureState private var translation: CGSize = .zero
    var body: some View {
        NativePlayer(material: material)
            .offset(x: position.width + translation.width, y: position.height + translation.height)
            .simultaneousGesture(DragGesture(minimumDistance: 8)
                .updating($translation) { value, state, transaction in
                    transaction.animation = nil
                    state = value.translation
                }
                .onEnded { value in
                    position.width += value.translation.width
                    position.height += value.translation.height
                })
            .onChange(of: reset) { position = .zero }
    }
}
private struct NativePlayer: View {
    let material: Glass
    @State private var liked = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 12).fill(LinearGradient(colors: [Color(red: 0.68, green: 0.75, blue: 0.77), Color(red: 0.32, green: 0.43, blue: 0.46), Color(red: 0.82, green: 0.67, blue: 0.55)], startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Weightless").font(.custom("InterVariable", size: 15).weight(.semibold))
                    Text("Marconi Union").font(.custom("InterVariable", size: 12)).opacity(0.6)
                }
                Spacer(minLength: 0)
                Button { liked.toggle() } label: {
                    NativeIcon(kind: .heart).opacity(liked ? 1 : 0.75).frame(width: 36, height: 36)
                        .glassEffect(material.interactive(), in: .capsule)
                }.buttonStyle(.plain).accessibilityLabel(liked ? "Unlike" : "Like")
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.primary.opacity(0.14))
                    Capsule().fill(.primary).frame(width: geometry.size.width * 0.34)
                }
            }.frame(height: 3).padding(.top, 24)
            HStack {
                Text("1:51")
                Spacer()
                Button {} label: { NativeIcon(kind: .play).frame(width: 40, height: 32) }
                    .buttonStyle(.plain).accessibilityLabel("Play")
                Spacer()
                Text("5:31")
            }.font(.custom("InterVariable", size: 10)).opacity(0.8).padding(.top, 12)
        }.padding(24).frame(width: 308)
            .glassEffect(material, in: .rect(cornerRadius: 38))
    }
}
struct NativeIcon: View {
    let kind: GlassIconKind
    var body: some View {
        GlassIcon(kind: kind).stroke(style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)).frame(width: 20, height: 20)
    }
}
