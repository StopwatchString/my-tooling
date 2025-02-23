#include "Component.hpp"
#include "namespace/SubComponent.hpp"

#include <stdlib.h>
#include <iostream>

int main()
{
    std::cout << "Hello World" << std::endl;

    Component c;
    c.print();

    Namespace::SubComponent sc;
    sc.print();

    return EXIT_SUCCESS;
}