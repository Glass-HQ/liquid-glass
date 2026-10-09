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
            case "iMessage": NativeMessagesScene(dark: dark, material: material, edgeStyle: edgeStyle)
            case "Article": NativeArticleScene(dark: dark, material: material, edgeStyle: edgeStyle)
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
private struct NativeMessagesScene: View {
    let dark: Bool
    let material: Glass
    let edgeStyle: String
    @State private var messages = ReferenceContent.shared.messages
    @State private var draft = ""
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    Text("Today 9:41").font(referenceFont(11)).foregroundStyle(.secondary).padding(.bottom, 6)
                    ForEach(messages) { message in
                        HStack {
                            if message.from == "me" { Spacer(minLength: 80) }
                            messageView(message)
                            if message.from != "me" { Spacer(minLength: 80) }
                        }.id(message.id)
                    }
                }.padding(.horizontal, 20).padding(.vertical, 8)
            }.modifier(NativeEdges(style: edgeStyle))
                .safeAreaBar(edge: .top, spacing: 0) { header }
                .safeAreaBar(edge: .bottom, spacing: 0) { composer }
                .onAppear { if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
                .onChange(of: messages.count) { if let id = messages.last?.id { proxy.scrollTo(id, anchor: .bottom) } }
        }.accessibilityElement(children: .contain).accessibilityLabel("Conversation with Maya")
    }
    @ViewBuilder private func messageView(_ message: ReferenceMessage) -> some View {
        if let photo = message.photo {
            if let image = photo == "day" ? ReferenceImages.day : ReferenceImages.night {
                Image(nsImage: image).resizable().scaledToFill().frame(width: 260, height: 170)
                    .clipShape(.rect(cornerRadius: 18)).accessibilityLabel(photo == "day" ? "Desert ridge at dusk" : "Desert ridge at night")
            }
        } else if message.link == true {
            VStack(alignment: .leading, spacing: 0) {
                if let image = ReferenceImages.night {
                    Image(nsImage: image).resizable().scaledToFill().frame(width: 260, height: 110).clipped()
                }
                Text("Dark Sky Places").font(referenceFont(13, .semibold)).padding(.horizontal, 12).padding(.top, 8)
                Text("darksky.org").font(referenceFont(13)).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.bottom, 9)
            }.frame(width: 260).background(dark ? Color(hex: 0x2c2c2e) : Color(hex: 0xe9e9eb), in: .rect(cornerRadius: 18))
                .clipShape(.rect(cornerRadius: 18))
        } else {
            Text(message.text ?? "").font(referenceFont(15)).lineSpacing(3)
                .padding(.vertical, 8).padding(.horizontal, 13).frame(maxWidth: 420, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(message.from == "me" || dark ? Color.white : .black)
                .background(message.from == "me" ? Color(hex: 0x0a84ff) : dark ? Color(hex: 0x2c2c2e) : Color(hex: 0xe9e9eb), in: .capsule)
        }
    }
    private var header: some View {
        HStack {
            NativeChromeButton(glyph: "ArrowLeft01Icon", label: "Back", material: material)
            Spacer()
            HStack(spacing: 8) {
                if let avatar = ReferenceImages.load("maya") { Image(nsImage: avatar).resizable().frame(width: 30, height: 30).clipShape(.circle) }
                Text("Maya").font(referenceFont(14, .semibold))
            }.padding(.leading, 4).padding(.trailing, 14).frame(height: 38).glassEffect(material, in: .capsule)
            Spacer()
            NativeChromeButton(glyph: "Video01Icon", label: "FaceTime", material: material)
        }.padding(.horizontal, 16).padding(.vertical, 14)
    }
    private var composer: some View {
        HStack(spacing: 8) {
            NativeChromeButton(glyph: "PlusSignIcon", label: "Attach", material: material)
            TextField("iMessage", text: $draft).textFieldStyle(.plain).font(referenceFont(15))
                .padding(.horizontal, 14).frame(height: 38)
                .glassEffect(material, in: .capsule).accessibilityLabel("Message").onSubmit(send)
            NativeChromeButton(glyph: "ArrowUp02Icon", label: "Send", material: material.tint(Color(hex: 0x0a84ff)), action: send)
        }.padding(.horizontal, 16).padding(.vertical, 14)
    }
    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(ReferenceMessage(id: (messages.last?.id ?? 0) + 1, from: "me", text: text))
        draft = ""
    }
}
private struct NativeArticleScene: View {
    let dark: Bool
    let material: Glass
    let edgeStyle: String
    @State private var collapsed = false
    private var article: ReferenceArticle { ReferenceContent.shared.article }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(article.title).font(.custom("Iowan Old Style", size: 40).weight(.bold)).tracking(-1.1).fixedSize(horizontal: false, vertical: true)
                Text(article.dek).font(.custom("Iowan Old Style", size: 20)).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    if let avatar = ReferenceImages.load("jonah") { Image(nsImage: avatar).resizable().frame(width: 32, height: 32).clipShape(.circle) }
                    Text(.init(article.byline)).font(referenceFont(13)).foregroundStyle(.secondary)
                }.padding(.bottom, 6)
                ForEach(Array(article.blocks.enumerated()), id: \.offset) { index, block in
                    blockView(block, index: index)
                }
            }.font(.custom("Iowan Old Style", size: 17)).lineSpacing(6)
                .padding(.horizontal, 24).padding(.top, 6).padding(.bottom, 32)
                .frame(maxWidth: 600, alignment: .leading).frame(maxWidth: .infinity)
        }.modifier(NativeEdges(style: edgeStyle))
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 110 } action: { _, value in collapsed = value }
            .safeAreaBar(edge: .top, spacing: 0) {
                HStack {
                    NativeChromeButton(glyph: "ArrowLeft01Icon", label: "Back", material: material)
                    Text(article.title).font(referenceFont(15, .semibold)).opacity(collapsed ? 1 : 0).frame(maxWidth: .infinity)
                    Color.clear.frame(width: 38, height: 38)
                }.padding(.horizontal, 16).padding(.vertical, 14)
            }
            .safeAreaBar(edge: .bottom, spacing: 0) {
                HStack(spacing: 4) {
                    NativeChromeButton(glyph: "Share08Icon", label: "Share", material: material)
                    NativeChromeButton(glyph: "Bookmark01Icon", label: "Save", material: material)
                }.padding(.vertical, 16)
            }.accessibilityElement(children: .contain).accessibilityLabel(article.title)
    }
    @ViewBuilder private func blockView(_ block: ReferenceArticleBlock, index: Int) -> some View {
        if block.kind == "figure" {
            let first = index == 0
            VStack(alignment: .leading, spacing: 8) {
                if let image = (first ? dark : !dark) ? ReferenceImages.night : ReferenceImages.day {
                    GeometryReader { geometry in
                        Image(nsImage: image).resizable().scaledToFill().frame(width: geometry.size.width, height: first ? 260 : 210).clipped()
                    }.frame(height: first ? 260 : 210).clipShape(.rect(cornerRadius: 25.5))
                }
                Text(block.text).font(referenceFont(12)).foregroundStyle(.secondary)
            }.padding(.bottom, 8)
        } else if block.kind == "h2" {
            Text(block.text).font(referenceFont(21, .semibold)).padding(.top, 16)
        } else if block.kind == "blockquote" {
            HStack(spacing: 20) {
                Rectangle().frame(width: 3)
                Text(.init(block.text)).font(.custom("Iowan Old Style", size: 23).italic())
            }.fixedSize(horizontal: false, vertical: true).padding(.vertical, 10)
        } else { Text(.init(block.text)).fixedSize(horizontal: false, vertical: true) }
    }
}
