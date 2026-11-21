import SwiftUI
import AppKit
import QuartzCore

struct NativeProgressiveScene: View {
    let mode: String
    let dark: Bool
    let material: Glass
    let edgeStyle: String
    let edge: String
    var body: some View {
        Group {
            switch mode {
            case "Image": image
            default: NativeLibraryScene(dark: dark, material: material, edgeStyle: edgeStyle)
            }
        }.background(dark ? Color(hex: 0x242320) : Color(hex: 0xf3efe8))
    }
    private var image: some View {
        GeometryReader { geometry in
            NativeBackdrop(background: "Landscape", dark: dark, size: geometry.size)
                .overlay(alignment: edge == "Top edge" ? .top : .bottom) {
                    if edgeStyle != "No blur" {
                        NativeImageEdge(top: edge == "Top edge", soft: edgeStyle == "Soft blur").frame(height: 260)
                    }
                }
                .overlay(alignment: edge == "Top edge" ? .topLeading : .bottomLeading) {
                    Text("A little further away.").font(referenceFont(min(40, max(26, geometry.size.width * 0.04)), .semibold))
                        .tracking(-1.2).padding(28)
                }
        }
    }
}
private struct NativeImageEdge: NSViewRepresentable {
    let top: Bool
    let soft: Bool
    func makeNSView(context: Context) -> EdgeMaterialView {
        let view = EdgeMaterialView()
        view.blendingMode = .withinWindow
        view.material = .contentBackground
        view.state = .active
        view.wantsLayer = true
        return view
    }
    func updateNSView(_ view: EdgeMaterialView, context: Context) {
        view.top = top
        view.soft = soft
        view.needsLayout = true
    }
}
private final class EdgeMaterialView: NSVisualEffectView {
    var top = false
    var soft = true
    override func layout() {
        super.layout()
        if soft {
            let mask = CAGradientLayer()
            mask.frame = bounds
            mask.colors = top ? [NSColor.clear.cgColor, NSColor.black.cgColor] : [NSColor.black.cgColor, NSColor.clear.cgColor]
            mask.locations = [0, 1]
            layer?.mask = mask
        } else { layer?.mask = nil }
    }
}
private struct NativeEdges: ViewModifier {
    let style: String
    var edges: Edge.Set = [.top, .bottom]
    func body(content: Content) -> some View {
        content.scrollEdgeEffectStyle(style == "Soft blur" ? .soft : .hard, for: edges)
            .scrollEdgeEffectHidden(style == "No blur", for: edges)
            .scrollIndicators(.hidden)
    }
}
private struct NativeLibraryScene: View {
    let dark: Bool
    let material: Glass
    let edgeStyle: String
    @State private var layout = "Grid"
    @State private var playing = false
    var body: some View {
        Group {
            if layout == "Row" {
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: 20) {
                        ForEach(ReferenceContent.shared.albums) { album in albumView(album).frame(width: 196) }
                    }.padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 56)
                }.modifier(NativeEdges(style: edgeStyle, edges: [.leading, .trailing]))
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 128), spacing: 18)], alignment: .leading, spacing: 22) {
                        ForEach(ReferenceContent.shared.albums) { album in albumView(album) }
                    }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 42)
                }.modifier(NativeEdges(style: edgeStyle))
            }
        }
        .safeAreaBar(edge: .top, spacing: 0) { header }
        .safeAreaBar(edge: .bottom, spacing: 0) { player.padding(.bottom, 14).padding(.top, 8) }
        .background(dark ? Color(hex: 0x1c1c1e) : Color(hex: 0xfbfbfd))
        .foregroundStyle(dark ? Color(hex: 0xf5f5f7) : Color(hex: 0x1d1d1f))
        .accessibilityElement(children: .contain).accessibilityLabel("Albums")
    }
    private func albumView(_ album: ReferenceAlbum) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ReferenceArtwork(url: album.art).aspectRatio(1, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 19)).shadow(color: .black.opacity(0.15), radius: 8, y: 4)
            Text(album.title).font(referenceFont(13, .semibold)).lineLimit(1).padding(.top, 9)
            Text(album.artist).font(referenceFont(12)).foregroundStyle(.secondary).lineLimit(1)
        }.accessibilityElement(children: .combine)
    }
    private var header: some View {
        HStack(spacing: 12) {
            Text("Library").font(referenceFont(28, .bold)).tracking(-0.8)
            NativeLayoutPicker(selection: $layout, material: material)
            Spacer(minLength: 40)
        }.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
    }
    private var player: some View {
        HStack(spacing: 4) {
            ReferenceArtwork(url: ReferenceContent.shared.nowPlaying.art).frame(width: 34, height: 34).clipShape(.circle).padding(.trailing, 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(ReferenceContent.shared.nowPlaying.title).font(referenceFont(13, .semibold))
                Text(ReferenceContent.shared.nowPlaying.artist).font(referenceFont(12)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button { playing.toggle() } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
            }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityLabel(playing ? "Pause" : "Play")
            NativeChromeButton(glyph: "NextIcon", label: "Next track", material: material)
        }.padding(.leading, 5).padding(.trailing, 6).padding(.vertical, 5).frame(maxWidth: 420)
            .glassEffect(material, in: .capsule).padding(.horizontal, 16)
    }
}
private struct NativeLayoutPicker: View {
    @Binding var selection: String
    let material: Glass
    var body: some View {
        Picker("Library layout", selection: $selection) {
            Label("Grid", systemImage: "square.grid.2x2").tag("Grid")
            Label("Row", systemImage: "list.bullet").tag("Row")
        }.pickerStyle(.segmented).labelsHidden().fixedSize()
    }
}
struct NativeChromeButton: View {
    let glyph: String
    let label: String
    let material: Glass
    var action: () -> Void = {}
    private var symbol: String {
        switch glyph {
        case "NextIcon": "forward.end"
        case "ArrowLeft01Icon": "chevron.left"
        case "PlusSignIcon": "plus"
        case "ArrowUp02Icon": "arrow.up"
        case "Video01Icon": "video"
        case "Share08Icon": "square.and.arrow.up"
        case "Bookmark01Icon": "bookmark"
        default: "ellipsis"
        }
    }
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
        }.buttonStyle(.glass).buttonBorderShape(.circle).accessibilityLabel(label).help(label)
    }
}
