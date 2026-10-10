import SwiftUI
import AppKit

// System controls own their material; adding glassEffect to their thumbs would
// turn this reference into a custom renderer instead of an Apple comparison.
struct NativeValueControls: View {
    let kind: ExampleKind
    let tint: Color?
    let stepped: Bool
    let api: String
    @State private var value = 50.0
    @State private var checked = true
    var body: some View {
        Group {
            if kind == .toggle {
                if api == "AppKit" { ReferenceSwitch(value: $checked).fixedSize() }
                else { Toggle("Switch", isOn: $checked).toggleStyle(.switch).labelsHidden().fixedSize() }
            } else {
                if api == "AppKit" { ReferenceSlider(value: $value, stepped: stepped).frame(width: 280, height: 28) }
                else if stepped {
                    Slider(value: $value, in: 0...100, step: 25) { Text("Slider") }
                        .labelsHidden().frame(width: 280)
                } else {
                    Slider(value: $value, in: 0...100) { Text("Slider") }
                        .labelsHidden().frame(width: 280)
                }
            }
        }.tint(tint ?? .accentColor)
            .onChange(of: stepped) { if stepped { value = (value / 25).rounded() * 25 } }
    }
}
private struct ReferenceSlider: NSViewRepresentable {
    @Binding var value: Double
    let stepped: Bool
    func makeCoordinator() -> Coordinator { Coordinator(value: $value) }
    func makeNSView(context: Context) -> NSSlider {
        let view = NSSlider(value: value, minValue: 0, maxValue: 100, target: context.coordinator, action: #selector(Coordinator.changed(_:)))
        view.isContinuous = true
        view.setAccessibilityLabel("Slider")
        return view
    }
    func updateNSView(_ view: NSSlider, context: Context) {
        context.coordinator.value = $value
        view.numberOfTickMarks = stepped ? 5 : 0
        view.allowsTickMarkValuesOnly = stepped
        view.doubleValue = value
    }
    final class Coordinator: NSObject {
        var value: Binding<Double>
        init(value: Binding<Double>) { self.value = value }
        @objc func changed(_ sender: NSSlider) { value.wrappedValue = sender.doubleValue }
    }
}
private struct ReferenceSwitch: NSViewRepresentable {
    @Binding var value: Bool
    func makeCoordinator() -> Coordinator { Coordinator(value: $value) }
    func makeNSView(context: Context) -> NSSwitch {
        let view = NSSwitch()
        view.target = context.coordinator
        view.action = #selector(Coordinator.changed(_:))
        view.setAccessibilityLabel("Switch")
        return view
    }
    func updateNSView(_ view: NSSwitch, context: Context) {
        context.coordinator.value = $value
        view.state = value ? .on : .off
    }
    final class Coordinator: NSObject {
        var value: Binding<Bool>
        init(value: Binding<Bool>) { self.value = value }
        @objc func changed(_ sender: NSSwitch) { value.wrappedValue = sender.state == .on }
    }
}
