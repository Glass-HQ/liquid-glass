import SwiftUI

struct NativeMenuOptions {
    var submenu = false
    var toolbar = false
}
struct NativeMenu: View {
    var options = NativeMenuOptions()
    var material: Glass = .regular
    var body: some View {
        NativeSwiftUIMenu(submenu: options.submenu)
            .menuStyle(.button).buttonStyle(.glass(material)).controlSize(.large).fixedSize()
    }
}
/// The site's floating toolbar, drawn with SwiftUI glass: one capsule per group, as a window
/// toolbar draws them, so its material can be chosen.
struct NativeSceneToolbar: View {
    let material: Glass
    let variant: String
    let submenu: Bool
    var body: some View {
        HStack(spacing: variant == "Fixed spacer" ? 24 : 8) {
            group {
                Button("Play", systemImage: "play.fill") { }
                Button("Volume", systemImage: "speaker.wave.3.fill") { }
            }
            if variant == "Flexible spacer" { Spacer().frame(width: 80) }
            group {
                Button("Favorite", systemImage: "heart") { }
                if variant == "With menu" { NativeSwiftUIMenu(submenu: submenu).menuIndicator(.hidden) }
            }
        }
        .labelStyle(.iconOnly).buttonStyle(.borderless).controlSize(.large)
    }
    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 4) { content() }
            .padding(.horizontal, 10).frame(height: 40)
            .glassEffect(material.interactive(), in: .capsule)
    }
}
struct NativeSwiftUIMenu: View {
    var submenu = false
    var body: some View {
        Menu("Options", systemImage: "ellipsis") {
            Button("Save to library", systemImage: "heart") { }
            if submenu {
                Menu("Share") {
                    Button("Copy link") { }
                    Button("Email") { }
                    Menu("More") {
                        Button("Messages") { }
                        Button("AirDrop") { }.disabled(true)
                    }
                }
            } else { Button("Share", systemImage: "square.and.arrow.up") { } }
            Button("Download", systemImage: "arrow.down.circle") { }
        }
    }
}
struct NativeMenuControls: View {
    @Binding var options: NativeMenuOptions
    var showsTrigger: Bool
    var body: some View {
        HStack(spacing: 16) {
            Toggle("With submenu", isOn: $options.submenu)
            if showsTrigger {
                Picker("Trigger", selection: $options.toolbar) {
                    Text("Button").tag(false)
                    Text("Window toolbar").tag(true)
                }.fixedSize()
            }
        }.padding(.horizontal, 16)
    }
}
