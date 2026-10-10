import SwiftUI

struct NativeMenuOptions {
    var submenu = false
    var toolbar = false
}
struct NativeMenu: View {
    var options = NativeMenuOptions()
    var body: some View {
        NativeSwiftUIMenu(submenu: options.submenu)
            .menuStyle(.automatic).controlSize(.large).fixedSize()
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
